import { vValidator } from '@hono/valibot-validator'
import { Result } from 'better-result'
import { Hono } from 'hono'
import {
	EntityParamsSchema,
	ManufacturerCreateSchema,
	ManufacturerListQuerySchema,
	ManufacturerUpdateSchema,
} from 'shared/src/schemas'
import { requireGlobalWrite } from '../authz'
import {
	createManufacturer,
	deleteManufacturer,
	getManufacturer,
	listManufacturers,
	updateManufacturer,
} from '../db/templates'
import { authMiddleware } from '../middleware/auth'
import { onValidationError } from '../middleware/validation'
import { sendResult } from '../util/result_response'

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
	.post('/', vValidator('json', ManufacturerCreateSchema, onValidationError), (c) => {
		const denied = requireGlobalWrite(c)
		if (denied) {
			return denied
		}
		const result = createManufacturer(c.req.valid('json'))
		if (Result.isOk(result)) {
			return c.json(result.value, 201)
		}
		return sendResult(c, result)
	})
	.get('/:id', vValidator('param', EntityParamsSchema, onValidationError), (c) => {
		return sendResult(c, getManufacturer(c.req.valid('param').id))
	})
	.patch(
		'/:id',
		vValidator('param', EntityParamsSchema, onValidationError),
		vValidator('json', ManufacturerUpdateSchema, onValidationError),
		(c) => {
			const denied = requireGlobalWrite(c)
			if (denied) {
				return denied
			}
			const result = updateManufacturer(c.req.valid('param').id, c.req.valid('json'))
			if (Result.isOk(result)) {
				return c.json(result.value)
			}
			return sendResult(c, result)
		},
	)
	.delete('/:id', vValidator('param', EntityParamsSchema, onValidationError), (c) => {
		const denied = requireGlobalWrite(c)
		if (denied) {
			return denied
		}
		const result = deleteManufacturer(c.req.valid('param').id)
		if (Result.isOk(result)) {
			return c.json(result.value)
		}
		return sendResult(c, result)
	})
