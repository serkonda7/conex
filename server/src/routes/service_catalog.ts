import {
	EntityParamsSchema,
	ManagedBundleCreateSchema,
	ManagedBundleListQuerySchema,
	ManagedBundleUpdateSchema,
	PriorityCreateSchema,
	PriorityListQuerySchema,
	PriorityUpdateSchema,
	ServiceLevelCreateSchema,
	ServiceLevelListQuerySchema,
	ServiceLevelUpdateSchema,
} from 'shared/src/schemas'
import {
	createManagedBundle,
	createPriority,
	createServiceLevel,
	deleteManagedBundle,
	deletePriority,
	deleteServiceLevel,
	getManagedBundle,
	getPriority,
	getServiceLevel,
	listManagedBundles,
	listPriorities,
	listServiceLevels,
	updateManagedBundle,
	updatePriority,
	updateServiceLevel,
} from '../db/service_catalog'
import { makeCatalogApp } from './crud'

/**
 * Service catalog (priorities, service levels, managed bundles) is shared
 * catalog data (no tenant column): readable by every authenticated user,
 * writable only by global editors/admins, so a tenant-scoped editor cannot
 * change the SLA terms other tenants are bound to.
 */
export const prioritiesApp = makeCatalogApp({
	listQuerySchema: PriorityListQuerySchema,
	createSchema: PriorityCreateSchema,
	updateSchema: PriorityUpdateSchema,
	paramSchema: EntityParamsSchema,
	list: listPriorities,
	create: createPriority,
	get: getPriority,
	update: updatePriority,
	remove: deletePriority,
})

export const serviceLevelsApp = makeCatalogApp({
	listQuerySchema: ServiceLevelListQuerySchema,
	createSchema: ServiceLevelCreateSchema,
	updateSchema: ServiceLevelUpdateSchema,
	paramSchema: EntityParamsSchema,
	list: listServiceLevels,
	create: createServiceLevel,
	get: getServiceLevel,
	update: updateServiceLevel,
	remove: deleteServiceLevel,
})

export const managedBundlesApp = makeCatalogApp({
	listQuerySchema: ManagedBundleListQuerySchema,
	createSchema: ManagedBundleCreateSchema,
	updateSchema: ManagedBundleUpdateSchema,
	paramSchema: EntityParamsSchema,
	list: listManagedBundles,
	create: createManagedBundle,
	get: getManagedBundle,
	update: updateManagedBundle,
	remove: deleteManagedBundle,
})
