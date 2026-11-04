/**
 * Permission-based access control plus tenant scoping.
 *
 * Permissions (`packages/shared/src/schemas.ts` `PERMISSIONS`) come from the user's
 * role: `view` / `edit` / `delete` cover all inventory and catalog
 * resources; `users.manage`, `changelog.view`, `audit_log.view` and
 * `integrations.manage` gate the admin areas; `tickets.create` allows
 * opening external tickets.
 *
 * Tenant scope (`CurrentUser.tenant_ids`, see `db/users.ts`):
 * - `null` = global, unconstrained. Always the case for `users.manage`
 *   holders (enforced in `db/users.ts` / `db/roles.ts`).
 * - a list = limited to those tenants: exactly the employee's tenants for
 *   employee-linked accounts, else the account's `user_tenants`. Strictly:
 *   only rows whose `tenant_id` is in the scope are visible or writable.
 *   Reads and writes follow the same rule. In particular, unscoped
 *   (`tenant_id IS NULL`) rows are invisible to scoped users — there is no
 *   shared visibility.
 * - Tenant-less catalog data (manufacturers, device types + stubs) is
 *   readable by everyone but writable only by global editors/admins.
 * - Employees belong to several tenants: any of them in scope grants access
 *   (see `routes/employees.ts`).
 * - Tenant-less child rows inherit their parent's tenant (`db/owners.ts`):
 *   interfaces follow their device, cables follow both endpoint devices
 *   (both endpoints must sit in scoped tenants).
 */

import { Result } from 'better-result'
import type { Context } from 'hono'
import { inScope, type TenantFilterParams } from './db/list'
import { resolveTenantGroupIds } from './db/tenancy'
import type { CurrentUser, Permission } from './types'
import { jsonError } from './util/http'
import { sendResult } from './util/result_response'

const OUTSIDE_SCOPE = 'Forbidden: outside your tenant scope'
const CABLE_OUTSIDE_SCOPE = 'Cable endpoints are outside your tenant scope'
const TENANT_REQUIRED = 'Select one of your tenants for the new object'

/** The authenticated requester attached by `authMiddleware`. */
export function requestUser(c: Context): CurrentUser {
	return c.get('currentUser') as CurrentUser
}

/** Effective tenant scope: the user's tenant ids, `null` when global. */
export function scopeTenantIds(user: CurrentUser): readonly number[] | null {
	return user.tenant_ids
}

/** The requester's scope as a db filter param: `undefined` when global. */
export function requestScope(c: Context): readonly number[] | undefined {
	return scopeTenantIds(requestUser(c)) ?? undefined
}

/** True when the requester is limited to tenants. */
export function isScoped(c: Context): boolean {
	return scopeTenantIds(requestUser(c)) !== null
}

/** True when the requester's role grants `permission`. */
export function can(user: CurrentUser, permission: Permission): boolean {
	return user.permissions.has(permission)
}

/** Scope rule (read and write): scoped users need a (non-null) tenant in their scope. */
export function canAccessTenant(user: CurrentUser, tenant: number | null): boolean {
	return inScope(tenant, scopeTenantIds(user) ?? undefined)
}

/** Cable rule (read and write): both endpoints must sit in scoped tenants. */
export function canAccessCable(
	user: CurrentUser,
	tenants: [number | null, number | null],
): boolean {
	return canAccessTenant(user, tenants[0]) && canAccessTenant(user, tenants[1])
}

/** 403 response in the shared `{ error }` shape. */
export function forbidden(c: Context, message = OUTSIDE_SCOPE): Response {
	return jsonError(c, message, 403)
}

/** Permission gate. Returns a 403 response or null. */
export function requirePermission(c: Context, permission: Permission): Response | null {
	if (!can(requestUser(c), permission)) {
		return forbidden(c, `Forbidden: ${permission} permission required`)
	}
	return null
}

/** Gate for operations only global (unscoped) requesters may perform. */
export function requireGlobalScope(c: Context, message: string): Response | null {
	return isScoped(c) ? forbidden(c, message) : null
}

/**
 * Permission gate for shared data (catalog, tenants, tenant links): scoped
 * users cannot change rows other tenants rely on.
 */
export function requireGlobalPermission(c: Context, permission: Permission): Response | null {
	return (
		requirePermission(c, permission) ??
		requireGlobalScope(c, 'Forbidden: tenant-scoped users cannot edit shared catalog data')
	)
}

/**
 * Single-object scope gate for a tenant-bearing row. `undefined` (the row
 * or its parent is missing, see `db/owners.ts`) passes, so the service
 * answers 404 instead of a 403 being invented.
 */
export function checkTenant(c: Context, tenant: number | null | undefined): Response | null {
	if (tenant === undefined || canAccessTenant(requestUser(c), tenant)) {
		return null
	}
	return forbidden(c)
}

/** Single-object scope gate for a row in several tenants: any of them in scope grants access. */
export function checkTenants(c: Context, tenants: readonly number[]): Response | null {
	const scope = scopeTenantIds(requestUser(c))
	return scope === null || tenants.some((id) => scope.includes(id)) ? null : forbidden(c)
}

/** Single-object scope gate for a cable, given its endpoint tenants. */
export function checkCable(c: Context, tenants: [number | null, number | null]): Response | null {
	return canAccessCable(requestUser(c), tenants) ? null : forbidden(c, CABLE_OUTSIDE_SCOPE)
}

/**
 * List-query `?tenant=` guard: a scoped requester asking for a different
 * tenant gets 403 instead of a silently re-scoped answer.
 */
export function checkListTenantParam(c: Context, param: number | undefined): Response | null {
	const scope = scopeTenantIds(requestUser(c))
	if (scope !== null && param !== undefined && !scope.includes(param)) {
		return forbidden(c)
	}
	return null
}

/**
 * Tenant a single-tenant request (sync, tickets, boards) acts on: the
 * explicit `param` (check it with `checkListTenantParam`), else the only
 * tenant of a scoped requester; `undefined` when neither applies.
 */
export function defaultTenant(c: Context, param: number | undefined): number | undefined {
	const scope = scopeTenantIds(requestUser(c))
	return param ?? (scope?.length === 1 ? scope[0] : undefined)
}

/**
 * Resolves the `tenant_id` a create should store. Scoped requesters must
 * name one of their tenants (auto-filled when omitted and the scope holds
 * exactly one); global requesters keep whatever the body carries
 * (`undefined` becomes `NULL`/shared).
 * Returns the resolved tenant id, a 403 response when the body names a
 * tenant outside the requester's scope, or a 400 response when a scoped
 * requester with several tenants names none.
 */
export function resolveCreateTenant(
	c: Context,
	inputTenant: number | null | undefined,
): number | null | Response {
	const scope = scopeTenantIds(requestUser(c))
	if (scope === null) {
		return inputTenant ?? null
	}
	if (inputTenant === undefined || inputTenant === null) {
		const only = scope.length === 1 ? scope[0] : undefined
		return only ?? jsonError(c, TENANT_REQUIRED, 400)
	}
	return scope.includes(inputTenant) ? inputTenant : forbidden(c)
}

/**
 * Validates a tenant-bearing update before it reaches the service layer:
 * the current row must be writable and the effective (post-patch) tenant
 * must stay writable. Returns the denial response, or null when allowed.
 */
export function checkUpdateTenant(
	c: Context,
	currentTenant: number | null,
	inputTenant: number | null | undefined,
): Response | null {
	return checkTenant(c, currentTenant) ?? checkTenant(c, inputTenant)
}

/**
 * List-query tenant plumbing for `?tenant=` / `?tenant_group=` endpoints.
 * Validates explicit params against the requester's scope (403 on
 * mismatch) and returns the `TenantFilterParams` to spread into the db
 * list call: the explicit `?tenant=`, `?tenant_group=` resolved to its
 * member ids (`tenantIds`) and, for scoped requesters, their scope
 * (`scopeTenantIds`); all of them intersect.
 * Returns a 403 response when a param names another tenant or a group
 * without any of the requester's tenants, 404 when the group does not exist.
 */
export async function listTenantScope(
	c: Context,
	queryTenant: number | undefined,
	queryTenantGroup?: number,
): Promise<TenantFilterParams | Response> {
	const denied = checkListTenantParam(c, queryTenant)
	if (denied) {
		return denied
	}
	let tenantIds: number[] | undefined
	if (queryTenantGroup !== undefined) {
		const ids = await resolveTenantGroupIds(queryTenantGroup)
		if (Result.isError(ids)) {
			return sendResult(c, ids)
		}
		tenantIds = ids.value
	}
	const scope = scopeTenantIds(requestUser(c))
	if (scope === null) {
		return { tenant: queryTenant, tenantIds }
	}
	if (tenantIds !== undefined && !tenantIds.some((id) => scope.includes(id))) {
		return forbidden(c)
	}
	return { tenant: queryTenant, tenantIds, scopeTenantIds: scope }
}

/** Sends a single tenant-bearing row: 404 when missing, 403 when out of scope. */
export function sendTenantRow<T extends { tenant_id: number | null }>(
	c: Context,
	result: Result<T, Error>,
): Response {
	if (Result.isError(result)) {
		return sendResult(c, result)
	}
	return checkTenant(c, result.value.tenant_id) ?? c.json(result.value)
}
