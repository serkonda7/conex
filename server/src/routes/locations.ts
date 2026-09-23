import {
	EntityParamsSchema,
	LocationCreateSchema,
	LocationListQuerySchema,
	LocationUpdateSchema,
} from 'shared/src/schemas'
import {
	createLocation,
	deleteLocation,
	getLocation,
	listLocations,
	updateLocation,
} from '../db/tenancy'
import { makeTenantApp } from './crud'

export const locationsApp = makeTenantApp({
	listQuerySchema: LocationListQuerySchema,
	createSchema: LocationCreateSchema,
	updateSchema: LocationUpdateSchema,
	paramSchema: EntityParamsSchema,
	list: listLocations,
	create: createLocation,
	get: getLocation,
	update: updateLocation,
	remove: deleteLocation,
	filters: (q: { site?: number; parent?: number }) => ({ site: q.site, parent: q.parent }),
})
