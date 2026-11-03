import {
	EntityParamsSchema,
	RackTypeCreateSchema,
	type RackTypeListQuery,
	RackTypeListQuerySchema,
	RackTypeUpdateSchema,
} from 'shared/src/schemas'
import {
	createRackType,
	deleteRackType,
	getRackType,
	listRackTypes,
	updateRackType,
} from '../db/rack_types'
import { makeCatalogApp } from './crud'

/** Rack types are shared catalog data, like manufacturers and device types. */
export const rackTypesApp = makeCatalogApp({
	listQuerySchema: RackTypeListQuerySchema,
	createSchema: RackTypeCreateSchema,
	updateSchema: RackTypeUpdateSchema,
	paramSchema: EntityParamsSchema,
	list: listRackTypes,
	create: createRackType,
	get: getRackType,
	update: updateRackType,
	remove: deleteRackType,
	filters: (q: RackTypeListQuery) => ({
		manufacturer: q.manufacturer,
		form_factor: q.form_factor,
		height: q.height,
	}),
})
