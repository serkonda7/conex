import { vValidator } from '@hono/valibot-validator'
import { Result } from 'better-result'
import { Hono } from 'hono'
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
import { authMiddleware } from '../middleware/auth'
import { onValidationError } from '../middleware/validation'
import { sendResult } from '../util/result_response'

export const locationsApp = new Hono()
	.use(authMiddleware)
	.get('/', vValidator('query', LocationListQuerySchema, onValidationError), (c) => {
		const query = c.req.valid('query')
		return c.json(
			listLocations({
				search: query.search,
				page: query.page,
				limit: query.limit,
				site: query.site,
				tenant: query.tenant,
				parent: query.parent,
			}),
		)
	})
	.post('/', vValidator('json', LocationCreateSchema, onValidationError), (c) => {
		const result = createLocation(c.req.valid('json'))
		if (Result.isOk(result)) {
			return c.json(result.value, 201)
		}
		return sendResult(c, result)
	})
	.get('/:id', vValidator('param', EntityParamsSchema, onValidationError), (c) => {
		return sendResult(c, getLocation(c.req.valid('param').id))
	})
	.patch(
		'/:id',
		vValidator('param', EntityParamsSchema, onValidationError),
		vValidator('json', LocationUpdateSchema, onValidationError),
		(c) => {
			const result = updateLocation(c.req.valid('param').id, c.req.valid('json'))
			if (Result.isOk(result)) {
				return c.json(result.value)
			}
			return sendResult(c, result)
		},
	)
	.delete('/:id', vValidator('param', EntityParamsSchema, onValidationError), (c) => {
		const result = deleteLocation(c.req.valid('param').id)
		if (Result.isOk(result)) {
			return c.json(result.value)
		}
		return sendResult(c, result)
	})
