/**
 * Session-wide permissions. The shell sets them from the signed-in user's
 * role; pages and shared components read them to hide add / import / edit /
 * delete actions and admin areas the user may not use (the server answers
 * such requests with 403 either way).
 */

import type { Permission, SessionUser } from 'shared/src/types'
import { createSignal } from 'solid-js'

const [permissions, setPermissions] = createSignal<ReadonlySet<Permission>>(new Set())
const [tenantIds, setTenantIds] = createSignal<readonly number[] | null>(null)
const [employeeId, setEmployeeId] = createSignal<number | null>(null)

/** Records the signed-in user's permissions, tenant scope and employee (cleared on sign-out). */
export function setSessionAccess(next: {
	permissions: readonly Permission[]
	tenantIds: readonly number[] | null
	employeeId: number | null
}): void {
	setPermissions(new Set(next.permissions))
	setTenantIds(next.tenantIds)
	setEmployeeId(next.employeeId)
}

/** True when the user's role grants `permission`. */
export function can(permission: Permission): boolean {
	return permissions().has(permission)
}

/** True when the user is limited to tenants. */
export function isScoped(): boolean {
	return tenantIds() !== null
}

/** Tenants a scoped user is limited to; null for global users. */
export function sessionTenantIds(): readonly number[] | null {
	return tenantIds()
}

/** The only tenant of a user limited to exactly one; null otherwise. */
export function sessionTenantId(): number | null {
	const ids = tenantIds()
	return ids?.length === 1 ? (ids[0] ?? null) : null
}

/** Employee the signed-in account belongs to; null when not linked. */
export function sessionEmployeeId(): number | null {
	return employeeId()
}

/** `permission` on shared data (catalog, tenants, tenant links): global users only. */
export function canGlobal(permission: Permission): boolean {
	return can(permission) && !isScoped()
}

let sessionUserHandler: ((user: SessionUser) => void) | null = null

/** Registers the shell's handler for a changed session identity (set by `App`). */
export function setSessionUserHandler(handler: ((user: SessionUser) => void) | null): void {
	sessionUserHandler = handler
}

/**
 * Hands the shell the session's new identity, e.g. after switching the role
 * the app is viewed as, so navigation, permissions and cached rows follow.
 */
export function updateSessionUser(user: SessionUser): void {
	sessionUserHandler?.(user)
}
