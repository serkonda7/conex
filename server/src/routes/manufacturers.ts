import { vValidator } from '@hono/valibot-validator'
import { Result } from 'better-result'
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
import { onValidationError } from '../middleware/validation'
import { sendResult } from '../util/result_response'

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
			const result = updateManufacturer(c.req.valid('param').id, c.req.valid('json'))
			if (Result.isOk(result)) {
				return c.json(result.value)
			}
			return sendResult(c, result)
		},
	)
	.delete('/:id', vValidator('param', EntityParamsSchema, onValidationError), (c) => {
		const result = deleteManufacturer(c.req.valid('param').id)
		if (Result.isOk(result)) {
			return c.json(result.value)
		}
		return sendResult(c, result)
	})
