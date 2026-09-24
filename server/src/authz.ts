/**
 * Role-based access control plus single-tenant scoping.
 *
 * Roles (`shared/src/schemas.ts` `RoleSchema`):
 * - `admin`: reads+writes everything, manages users/roles. Ignores tenant scope.
 * - `editor`: reads+writes inventory, no user management.
 * - `viewer`: reads only (any POST/PATCH/PUT/DELETE answers 403).
 *
 * Tenant scope (`users.tenant_id`):
 * - `NULL` (or admin) = global, unconstrained.
 * - set (editors/viewers only; admins are always global) = limited to that
 *   single tenant, strictly: only rows whose `tenant_id` equals the scope
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
import { type cables, devices, interfaces, racks, shelves } from './schema'
import type { CurrentUser } from './types'
import { jsonError } from './util/http'
import { sendResult } from './util/result_response'

/** The authenticated requester attached by `authMiddleware`. */
export function requestUser(c: Context): CurrentUser {
	return c.get('currentUser') as CurrentUser
}

/**
 * Effective tenant scope: a tenant id for scoped editors/viewers, `null`
 * when the requester is unconstrained (admin or global editor/viewer).
 */
export function scopeTenantId(user: CurrentUser): number | null {
	if (user.role === 'admin' || user.tenant_id === null) {
		return null
	}
	return user.tenant_id
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

/** Admin-only gate (user management). Returns a 403 response or null. */
export function requireAdmin(c: Context): Response | null {
	if (requestUser(c).role !== 'admin') {
		return jsonError(c, 'Forbidden: admin role required', 403)
	}
	return null
}

/** Write gate (editors + admins). Returns a 403 response or null. */
export function requireWrite(c: Context): Response | null {
	const role = requestUser(c).role
	if (role !== 'admin' && role !== 'editor') {
		return jsonError(c, 'Forbidden: editor role required', 403)
	}
	return null
}

/** Global-catalog write gate: scoped users cannot edit shared templates. */
export function requireGlobalWrite(c: Context): Response | null {
	const write = requireWrite(c)
	if (write) {
		return write
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
 * List-query tenant plumbing for `?tenant=` endpoints. Validates an explicit
 * param against the requester's scope (403 on mismatch) and returns the
 * `{ tenant, scopeTenantId }` overrides to spread into the db list call:
 * scoped requesters get `{ scopeTenantId: scope }` (own tenant only),
 * global requesters keep their explicit `?tenant=` when given.
 * Returns a 403 response when the param names another tenant.
 */
export function listTenantScope(
	c: Context,
	queryTenant: number | undefined,
): { tenant?: number; scopeTenantId?: number } | Response {
	const denied = checkListTenantParam(c, queryTenant)
	if (denied) {
		return denied
	}
	const scope = scopeTenantId(requestUser(c))
	if (scope !== null) {
		return { scopeTenantId: scope }
	}
	if (queryTenant !== undefined) {
		return { tenant: queryTenant }
	}
	return {}
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
 * Update gate for a tenant-bearing row: writer role plus current-row and
 * post-patch tenant checks. Returns a denial response, or null when the
 * service call may proceed.
 */
export function guardUpdate(
	c: Context,
	currentTenant: number | null,
	inputTenant: number | null | undefined,
): Response | null {
	const denied = requireWrite(c)
	if (denied) {
		return denied
	}
	return checkUpdateTenant(c, currentTenant, inputTenant)
}

/** Delete gate for a tenant-bearing row: writer role plus scope check. */
export function guardWrite(c: Context, currentTenant: number | null): Response | null {
	const denied = requireWrite(c)
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
export function rackTenant(rackId: number): number | null | undefined {
	const rack = getDb().select().from(racks).where(eq(racks.id, rackId)).get()
	return rack?.tenant_id
}

/** Tenant of a device, or `undefined` when the device is missing. */
export function deviceTenant(deviceId: number): number | null | undefined {
	const device = getDb().select().from(devices).where(eq(devices.id, deviceId)).get()
	return device?.tenant_id
}

/**
 * Tenant of a shelf, inherited from its rack; `undefined` when either is
 * missing. `db/shelves.ts` owns the same lookup for service-layer paths.
 */
export function shelfTenant(shelfId: number): number | null | undefined {
	const shelf = getDb().select().from(shelves).where(eq(shelves.id, shelfId)).get()
	if (!shelf) {
		return undefined
	}
	const rack = getDb().select().from(racks).where(eq(racks.id, shelf.rack_id)).get()
	return rack?.tenant_id
}

/** Tenant of an interface's device, or `undefined` when either is missing. */
export function interfaceTenant(interfaceId: number): number | null | undefined {
	const iface = getDb().select().from(interfaces).where(eq(interfaces.id, interfaceId)).get()
	if (!iface) {
		return undefined
	}
	return deviceTenant(iface.device_id)
}

/** Tenants of both endpoint devices of a cable row. */
export function cableTenants(cable: typeof cables.$inferSelect): [number | null, number | null] {
	const db = getDb()
	const tenantOf = (interfaceId: number): number | null => {
		const iface = db.select().from(interfaces).where(eq(interfaces.id, interfaceId)).get()
		if (!iface) {
			return null
		}
		const device = db.select().from(devices).where(eq(devices.id, iface.device_id)).get()
		return device?.tenant_id ?? null
	}
	return [tenantOf(cable.a_interface_id), tenantOf(cable.b_interface_id)]
}

/** Cable read rule: both endpoints must sit in the scoped tenant. */
export function canReadCable(user: CurrentUser, tenants: [number | null, number | null]): boolean {
	return canReadTenant(user, tenants[0]) && canReadTenant(user, tenants[1])
}

/** Cable write rule: same as read — both endpoints in the scoped tenant. */
export function canWriteCable(user: CurrentUser, tenants: [number | null, number | null]): boolean {
	return canReadCable(user, tenants)
}
