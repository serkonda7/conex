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

/**
 * The integration permissions are cumulative the same way:
 * `write` = `integrations.write` (matching and report pages),
 * `manage` = write + `integrations.manage` (the integrations page: configure
 * and sync providers).
 */
export const INTEGRATION_ACCESS_LEVELS = ['write', 'manage'] as const

export type IntegrationAccess = (typeof INTEGRATION_ACCESS_LEVELS)[number] | ''

/** Permissions covered by the integration access level. */
export const INTEGRATION_PERMISSIONS: readonly Permission[] = [
	'integrations.write',
	'integrations.manage',
]

const INTEGRATION_GRANTS: Record<IntegrationAccess, readonly Permission[]> = {
	'': [],
	write: ['integrations.write'],
	manage: ['integrations.write', 'integrations.manage'],
}

/** Integration permissions granted by `level`. */
export function integrationPermissions(level: IntegrationAccess): readonly Permission[] {
	return INTEGRATION_GRANTS[level]
}

/** Highest integration level a permission set reaches. */
export function integrationAccess(permissions: Iterable<Permission>): IntegrationAccess {
	const set = new Set(permissions)
	if (set.has('integrations.manage')) {
		return 'manage'
	}
	return set.has('integrations.write') ? 'write' : ''
}
