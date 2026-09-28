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
	.get('/', vValidator('query', ManufacturerListQuerySchema, onValidationError), async (c) => {
		const query = c.req.valid('query')
		return c.json(
			await listManufacturers({
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
		async (c) => {
			return sendCreated(c, await createManufacturer(c.req.valid('json')))
		},
	)
	.get('/:id', vValidator('param', EntityParamsSchema, onValidationError), async (c) => {
		return sendRow(c, await getManufacturer(c.req.valid('param').id))
	})
	.patch(
		'/:id',
		requireGlobalWriteMiddleware,
		vValidator('param', EntityParamsSchema, onValidationError),
		vValidator('json', ManufacturerUpdateSchema, onValidationError),
		async (c) => {
			return sendRow(
				c,
				await updateManufacturer(c.req.valid('param').id, c.req.valid('json')),
			)
		},
	)
	.delete(
		'/:id',
		requireGlobalWriteMiddleware,
		vValidator('param', EntityParamsSchema, onValidationError),
		async (c) => {
			return sendRow(c, await deleteManufacturer(c.req.valid('param').id))
		},
	)
