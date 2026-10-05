/**
 * Permission-based access control plus single-tenant scoping.
 *
 * Permissions (`shared/src/schemas.ts` `PERMISSIONS`) come from the user's
 * role: `view` / `edit` / `delete` cover all inventory and catalog
 * resources; `users.manage`, `changelog.view`, `audit_log.view` and
 * `integrations.manage` gate the admin areas; `tickets.create` allows
 * opening external tickets.
 *
 * Tenant scope (`users.tenant_id`):
 * - `NULL` = global, unconstrained. Always the case for `users.manage`
 *   holders (enforced in `db/users.ts` / `db/roles.ts`).
 * - set = limited to that single tenant, strictly: only rows whose `tenant_id` equals the scope
 *   are visible or writable. Reads and writes follow the same rule. In
 *   particular, unscoped (`tenant_id IS NULL`) rows are invisible to scoped
 *   users — there is no shared visibility.
 * - Tenant-less catalog data (manufacturers, device types + stubs) is
 *   readable by everyone but writable only by global editors/admins.
 * - Tenant-less child rows inherit their parent's tenant (`db/owners.ts`):
 *   interfaces follow their device, cables follow both endpoint devices
 *   (both endpoints must sit in the scoped tenant).
 */

import { Result } from 'better-result'
import type { Context } from 'hono'
import type { TenantFilterParams } from './db/list'
import { resolveTenantGroupIds } from './db/tenancy'
import type { CurrentUser, Permission } from './types'
import { jsonError } from './util/http'
import { sendResult } from './util/result_response'

const OUTSIDE_SCOPE = 'Forbidden: outside your tenant scope'
const CABLE_OUTSIDE_SCOPE = 'Cable endpoints are outside your tenant scope'

/** The authenticated requester attached by `authMiddleware`. */
export function requestUser(c: Context): CurrentUser {
	return c.get('currentUser') as CurrentUser
}

/** Effective tenant scope: the user's tenant id, `null` when global. */
export function scopeTenantId(user: CurrentUser): number | null {
	return user.tenant_id
}

/** The requester's scope as a db filter param: `undefined` when global. */
export function requestScope(c: Context): number | undefined {
	return scopeTenantId(requestUser(c)) ?? undefined
}

/** True when the requester's role grants `permission`. */
export function can(user: CurrentUser, permission: Permission): boolean {
	return user.permissions.has(permission)
}

/** Scope rule (read and write): scope members need an exact (non-null) tenant match. */
export function canAccessTenant(user: CurrentUser, tenant: number | null): boolean {
	const scope = scopeTenantId(user)
	return scope === null || tenant === scope
}

/** Cable rule (read and write): both endpoints must sit in the scoped tenant. */
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
	return scopeTenantId(requestUser(c)) === null ? null : forbidden(c, message)
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

/** Single-object scope gate for a cable, given its endpoint tenants. */
export function checkCable(c: Context, tenants: [number | null, number | null]): Response | null {
	return canAccessCable(requestUser(c), tenants) ? null : forbidden(c, CABLE_OUTSIDE_SCOPE)
}

/**
 * List-query `?tenant=` guard: a scoped requester asking for a different
 * tenant gets 403 instead of a silently re-scoped answer.
 */
export function checkListTenantParam(c: Context, param: number | undefined): Response | null {
	const scope = scopeTenantId(requestUser(c))
	if (scope !== null && param !== undefined && param !== scope) {
		return forbidden(c)
	}
	return null
}

/**
 * Resolves the `tenant_id` a create should store. Scoped requesters have it
 * forced to their scope (auto-filled when omitted); global requesters keep
 * whatever the body carries (`undefined` becomes `NULL`/shared).
 * Returns the resolved tenant id, or a 403 response when the body names a
 * tenant outside the requester's scope.
 */
export function resolveCreateTenant(
	c: Context,
	inputTenant: number | null | undefined,
): number | null | Response {
	const scope = scopeTenantId(requestUser(c))
	if (scope === null) {
		return inputTenant ?? null
	}
	return inputTenant === undefined || inputTenant === scope ? scope : forbidden(c)
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
 * list call: scoped requesters get `{ scopeTenantId: scope }` (own tenant
 * only), global requesters keep their explicit `?tenant=` and get
 * `?tenant_group=` resolved to its member ids (`tenantIds`).
 * Returns a 403 response when a param names another tenant or a group
 * without the requester's tenant, 404 when the group does not exist.
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
	const scope = scopeTenantId(requestUser(c))
	if (scope !== null) {
		if (tenantIds !== undefined && !tenantIds.includes(scope)) {
			return forbidden(c)
		}
		return { scopeTenantId: scope }
	}
	return { tenant: queryTenant, tenantIds }
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
