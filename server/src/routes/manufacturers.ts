import {
	EntityParamsSchema,
	ManufacturerCreateSchema,
	ManufacturerListQuerySchema,
	ManufacturerUpdateSchema,
} from 'shared/src/schemas'
import {
	createManufacturer,
	deleteManufacturer,
	getManufacturer,
	listManufacturers,
	updateManufacturer,
} from '../db/templates'
import { makeCatalogApp } from './crud'

/**
 * Manufacturers are shared catalog data (no tenant column): readable by
 * every authenticated user, writable only by global editors/admins, so a
 * tenant-scoped editor cannot rename shared rows out from under others.
 */
export const manufacturersApp = makeCatalogApp({
	listQuerySchema: ManufacturerListQuerySchema,
	createSchema: ManufacturerCreateSchema,
	updateSchema: ManufacturerUpdateSchema,
	paramSchema: EntityParamsSchema,
	list: listManufacturers,
	create: createManufacturer,
	get: getManufacturer,
	update: updateManufacturer,
	remove: deleteManufacturer,
})
