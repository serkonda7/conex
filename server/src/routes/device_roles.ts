import {
	DeviceRoleCreateSchema,
	DeviceRoleListQuerySchema,
	DeviceRoleUpdateSchema,
	EntityParamsSchema,
} from 'shared/src/schemas'
import {
	createDeviceRole,
	deleteDeviceRole,
	getDeviceRole,
	listDeviceRoles,
	updateDeviceRole,
} from '../db/device_roles'
import { makeCatalogApp } from './crud'

/**
 * Device roles are shared catalog data (no tenant column): readable by
 * every authenticated user, writable only by global editors/admins, so a
 * tenant-scoped editor cannot rename shared rows out from under others.
 */
export const deviceRolesApp = makeCatalogApp({
	listQuerySchema: DeviceRoleListQuerySchema,
	createSchema: DeviceRoleCreateSchema,
	updateSchema: DeviceRoleUpdateSchema,
	paramSchema: EntityParamsSchema,
	list: listDeviceRoles,
	create: createDeviceRole,
	get: getDeviceRole,
	update: updateDeviceRole,
	remove: deleteDeviceRole,
})
