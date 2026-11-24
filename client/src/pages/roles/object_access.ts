import type { Permission } from 'shared/src/types'

/**
 * The three inventory/catalog permissions are cumulative on the role form:
 * `read` = view, `write` = view + edit, `manage` = view + edit + delete.
 * `''` grants none of them.
 */
export const OBJECT_ACCESS_LEVELS = ['read', 'write', 'manage'] as const

export type ObjectAccess = (typeof OBJECT_ACCESS_LEVELS)[number] | ''

/** Permissions covered by the object access level. */
export const OBJECT_PERMISSIONS: readonly Permission[] = ['view', 'edit', 'delete']

const GRANTS: Record<ObjectAccess, readonly Permission[]> = {
	'': [],
	read: ['view'],
	write: ['view', 'edit'],
	manage: ['view', 'edit', 'delete'],
}

/** Object permissions granted by `level`. */
export function objectPermissions(level: ObjectAccess): readonly Permission[] {
	return GRANTS[level]
}

/** Highest level a permission set reaches, judged by its strongest object permission. */
export function objectAccess(permissions: Iterable<Permission>): ObjectAccess {
	const set = new Set(permissions)
	if (set.has('delete')) {
		return 'manage'
	}
	if (set.has('edit')) {
		return 'write'
	}
	return set.has('view') ? 'read' : ''
}
