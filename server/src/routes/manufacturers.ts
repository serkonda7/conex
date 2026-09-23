import { vValidator } from '@hono/valibot-validator'
import { Hono } from 'hono'
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
import { authMiddleware } from '../middleware/auth'
import { requireGlobalWriteMiddleware } from '../middleware/roles'
import { onValidationError } from '../middleware/validation'
import { sendCreated, sendRow } from './helpers'

/**
 * Manufacturers are shared catalog data (no tenant column): readable by
 * every authenticated user, writable only by global editors/admins, so a
 * tenant-scoped editor cannot rename shared rows out from under others.
 */
export const manufacturersApp = new Hono()
	.use(authMiddleware)
	.get('/', vValidator('query', ManufacturerListQuerySchema, onValidationError), (c) => {
		const query = c.req.valid('query')
		return c.json(
			listManufacturers({
				search: query.search,
				page: query.page,
				limit: query.limit,
				sort: query.sort,
				order: query.order,
			}),
		)
	})
	.post(
		'/',
		requireGlobalWriteMiddleware,
		vValidator('json', ManufacturerCreateSchema, onValidationError),
		(c) => {
			return sendCreated(c, createManufacturer(c.req.valid('json')))
		},
	)
	.get('/:id', vValidator('param', EntityParamsSchema, onValidationError), (c) => {
		return sendRow(c, getManufacturer(c.req.valid('param').id))
	})
	.patch(
		'/:id',
		requireGlobalWriteMiddleware,
		vValidator('param', EntityParamsSchema, onValidationError),
		vValidator('json', ManufacturerUpdateSchema, onValidationError),
		(c) => {
			return sendRow(c, updateManufacturer(c.req.valid('param').id, c.req.valid('json')))
		},
	)
	.delete(
		'/:id',
		requireGlobalWriteMiddleware,
		vValidator('param', EntityParamsSchema, onValidationError),
		(c) => {
			return sendRow(c, deleteManufacturer(c.req.valid('param').id))
		},
	)
