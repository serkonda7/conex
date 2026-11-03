import {
	DeviceRoleCreateSchema,
	DeviceRoleListQuerySchema,
	DeviceRoleUpdateSchema,
	EntityParamsSchema,
} from 'shared/src/schemas'
import {
	createDeviceRole,
	deleteDeviceRole,
	getDeviceRoleDetail,
	listDeviceRoles,
	updateDeviceRole,
} from '../db/device_roles'
import { makeCatalogApp } from './crud'

/**
 * Device roles are shared catalog data (no tenant column): readable by
 * every authenticated user, writable only by global editors/admins, so a
 * tenant-scoped editor cannot rename shared rows out from under others.
 * `?parent=<id>` lists a role's direct child roles.
 */
export const deviceRolesApp = makeCatalogApp({
	listQuerySchema: DeviceRoleListQuerySchema,
	createSchema: DeviceRoleCreateSchema,
	updateSchema: DeviceRoleUpdateSchema,
	paramSchema: EntityParamsSchema,
	filters: (q: { parent?: number; can_host_vms?: boolean; bundle?: number[] }) => ({
		parent: q.parent,
		can_host_vms: q.can_host_vms,
		bundle: q.bundle,
	}),
	list: listDeviceRoles,
	create: createDeviceRole,
	get: getDeviceRoleDetail,
	update: updateDeviceRole,
	remove: deleteDeviceRole,
})
