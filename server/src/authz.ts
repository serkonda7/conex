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
 *   are visible or writable. In particular, unscoped (`tenant_id IS NULL`)
 *   rows are invisible to scoped users — there is no shared visibility.
 * - Tenant-less catalog data (manufacturers, device types + stubs) is
 *   readable by everyone but writable only by global editors/admins.
 * - Tenant-less child rows inherit their parent's tenant: interfaces follow
 *   their device, cables follow both endpoint
 *   devices (both endpoints must sit in the scoped tenant).
 */

import { Result } from 'better-result'
import { eq } from 'drizzle-orm'
import type { Context } from 'hono'
import { getDb } from './db/connection'
import type { TenantFilterParams } from './db/list'
import { resolveTenantGroupIds } from './db/tenancy'
import { type cables, devices, interfaces, racks, shelves } from './schema'
import type { CurrentUser, Permission } from './types'
import { jsonError } from './util/http'
import { sendResult } from './util/result_response'

/** The authenticated requester attached by `authMiddleware`. */
export function requestUser(c: Context): CurrentUser {
	return c.get('currentUser') as CurrentUser
}

/** Effective tenant scope: the user's tenant id, `null` when global. */
export function scopeTenantId(user: CurrentUser): number | null {
	return user.tenant_id
}

/** True when the requester's role grants `permission`. */
export function can(user: CurrentUser, permission: Permission): boolean {
	return user.permissions.has(permission)
}

/** Read rule: scope members see exactly their own tenant — no shared rows. */
export function canReadTenant(user: CurrentUser, tenant: number | null): boolean {
	const scope = scopeTenantId(user)
	if (scope === null) {
		return true
	}
	return tenant !== null && tenant === scope
}

/** Write rule: scope members need an exact (non-null) tenant match. */
export function canWriteTenant(user: CurrentUser, tenant: number | null): boolean {
	const scope = scopeTenantId(user)
	if (scope === null) {
		return true
	}
	return tenant !== null && tenant === scope
}

/** Permission gate. Returns a 403 response or null. */
export function requirePermission(c: Context, permission: Permission): Response | null {
	if (!can(requestUser(c), permission)) {
		return jsonError(c, `Forbidden: ${permission} permission required`, 403)
	}
	return null
}

/**
 * Permission gate for shared data (catalog, tenants, tenant links): scoped
 * users cannot change rows other tenants rely on.
 */
export function requireGlobalPermission(c: Context, permission: Permission): Response | null {
	const denied = requirePermission(c, permission)
	if (denied) {
		return denied
	}
	if (scopeTenantId(requestUser(c)) !== null) {
		return jsonError(c, 'Forbidden: tenant-scoped users cannot edit shared catalog data', 403)
	}
	return null
}

/** Single-object read gate for a tenant-bearing row. */
export function checkRead(c: Context, tenant: number | null): Response | null {
	if (!canReadTenant(requestUser(c), tenant)) {
		return jsonError(c, 'Forbidden: outside your tenant scope', 403)
	}
	return null
}

/** Single-object write gate for a tenant-bearing row. */
export function checkWrite(c: Context, tenant: number | null): Response | null {
	if (!canWriteTenant(requestUser(c), tenant)) {
		return jsonError(c, 'Forbidden: outside your tenant scope', 403)
	}
	return null
}

/**
 * List-query `?tenant=` guard: a scoped requester asking for a different
 * tenant gets 403 instead of a silently re-scoped answer.
 */
export function checkListTenantParam(c: Context, param: number | undefined): Response | null {
	const scope = scopeTenantId(requestUser(c))
	if (scope !== null && param !== undefined && param !== scope) {
		return jsonError(c, 'Forbidden: outside your tenant scope', 403)
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
	if (scope !== null) {
		if (inputTenant !== undefined && inputTenant !== scope) {
			return jsonError(c, 'Forbidden: outside your tenant scope', 403)
		}
		return scope
	}
	return inputTenant ?? null
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
	const denied = checkWrite(c, currentTenant)
	if (denied) {
		return denied
	}
	if (inputTenant !== undefined) {
		return checkWrite(c, inputTenant)
	}
	return null
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
			return jsonError(c, 'Forbidden: outside your tenant scope', 403)
		}
		return { scopeTenantId: scope }
	}
	return {
		...(queryTenant !== undefined ? { tenant: queryTenant } : {}),
		...(tenantIds !== undefined ? { tenantIds } : {}),
	}
}

/** Sends a single tenant-bearing row: 404 when missing, 403 when out of scope. */
export function sendTenantRow<T extends { tenant_id: number | null }>(
	c: Context,
	result: Result<T, Error>,
): Response {
	if (Result.isError(result)) {
		return sendResult(c, result)
	}
	const denied = checkRead(c, result.value.tenant_id)
	if (denied) {
		return denied
	}
	return c.json(result.value)
}

/**
 * Update gate for a tenant-bearing row: `edit` permission plus current-row
 * and post-patch tenant checks. Returns a denial response, or null when the
 * service call may proceed.
 */
export function guardUpdate(
	c: Context,
	currentTenant: number | null,
	inputTenant: number | null | undefined,
): Response | null {
	const denied = requirePermission(c, 'edit')
	if (denied) {
		return denied
	}
	return checkUpdateTenant(c, currentTenant, inputTenant)
}

/** Gate for a tenant-bearing row: `permission` plus scope check. */
export function guardWrite(
	c: Context,
	permission: Permission,
	currentTenant: number | null,
): Response | null {
	const denied = requirePermission(c, permission)
	if (denied) {
		return denied
	}
	return checkWrite(c, currentTenant)
}

// ---------------------------------------------------------------------------
// Parent-tenant resolvers for tenant-less child rows.
// `undefined` means the row (or its parent) does not exist; callers then
// fall through to the normal 404 path instead of inventing a 403.
// ---------------------------------------------------------------------------

/** Tenant of a rack, or `undefined` when the rack is missing. */
export async function rackTenant(rackId: number): Promise<number | null | undefined> {
	const rack = (await getDb().select().from(racks).where(eq(racks.id, rackId)).limit(1))[0]
	return rack?.tenant_id
}

/** Tenant of a device, or `undefined` when the device is missing. */
export async function deviceTenant(deviceId: number): Promise<number | null | undefined> {
	const device = (
		await getDb().select().from(devices).where(eq(devices.id, deviceId)).limit(1)
	)[0]
	return device?.tenant_id
}

/**
 * Tenant of a shelf, inherited from its rack; `undefined` when either is
 * missing. `db/shelves.ts` owns the same lookup for service-layer paths.
 */
export async function shelfTenant(shelfId: number): Promise<number | null | undefined> {
	const shelf = (await getDb().select().from(shelves).where(eq(shelves.id, shelfId)).limit(1))[0]
	if (!shelf) {
		return undefined
	}
	const rack = (await getDb().select().from(racks).where(eq(racks.id, shelf.rack_id)).limit(1))[0]
	return rack?.tenant_id
}

/** Tenant of an interface's device, or `undefined` when either is missing. */
export async function interfaceTenant(interfaceId: number): Promise<number | null | undefined> {
	const iface = (
		await getDb().select().from(interfaces).where(eq(interfaces.id, interfaceId)).limit(1)
	)[0]
	if (!iface) {
		return undefined
	}
	return await deviceTenant(iface.device_id)
}

/** Tenants of both endpoint devices of a cable row. */
export async function cableTenants(
	cable: typeof cables.$inferSelect,
): Promise<[number | null, number | null]> {
	const db = getDb()
	const tenantOf = async (interfaceId: number): Promise<number | null> => {
		const iface = (
			await db.select().from(interfaces).where(eq(interfaces.id, interfaceId)).limit(1)
		)[0]
		if (!iface) {
			return null
		}
		const device = (
			await db.select().from(devices).where(eq(devices.id, iface.device_id)).limit(1)
		)[0]
		return device?.tenant_id ?? null
	}
	return [await tenantOf(cable.a_interface_id), await tenantOf(cable.b_interface_id)]
}

/** Cable read rule: both endpoints must sit in the scoped tenant. */
export function canReadCable(user: CurrentUser, tenants: [number | null, number | null]): boolean {
	return canReadTenant(user, tenants[0]) && canReadTenant(user, tenants[1])
}

/** Cable write rule: same as read — both endpoints in the scoped tenant. */
export function canWriteCable(user: CurrentUser, tenants: [number | null, number | null]): boolean {
	return canReadCable(user, tenants)
}
