/**
 * Session-wide permissions. The shell sets them from the signed-in user's
 * role; pages and shared components read them to hide add / import / edit /
 * delete actions and admin areas the user may not use (the server answers
 * such requests with 403 either way).
 */

import type { Permission } from 'shared/src/types'
import { createSignal } from 'solid-js'

const [permissions, setPermissions] = createSignal<ReadonlySet<Permission>>(new Set())
const [scoped, setScoped] = createSignal(false)

/** Records the signed-in user's permissions and tenant scope (cleared on sign-out). */
export function setSessionAccess(next: {
	permissions: readonly Permission[]
	scoped: boolean
}): void {
	setPermissions(new Set(next.permissions))
	setScoped(next.scoped)
}

/** True when the user's role grants `permission`. */
export function can(permission: Permission): boolean {
	return permissions().has(permission)
}

/** True when the user is limited to one tenant. */
export function isScoped(): boolean {
	return scoped()
}

/** `permission` on shared data (catalog, tenants, tenant links): global users only. */
export function canGlobal(permission: Permission): boolean {
	return can(permission) && !scoped()
}
