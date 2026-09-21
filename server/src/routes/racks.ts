import { vValidator } from '@hono/valibot-validator'
import { Result } from 'better-result'
import { Hono } from 'hono'
import {
	EntityParamsSchema,
	RackCreateSchema,
	RackListQuerySchema,
	RackUpdateSchema,
} from 'shared/src/schemas'
import { createRack, deleteRack, getElevation, getRack, listRacks, updateRack } from '../db/racks'
import { authMiddleware } from '../middleware/auth'
import { onValidationError } from '../middleware/validation'
import { sendResult } from '../util/result_response'

export const racksApp = new Hono()
	.use(authMiddleware)
	.get('/', vValidator('query', RackListQuerySchema, onValidationError), (c) => {
		const query = c.req.valid('query')
		return c.json(
			listRacks({
				search: query.search,
				page: query.page,
				limit: query.limit,
				site: query.site,
				location: query.location,
				tenant: query.tenant,
				sort: query.sort,
				order: query.order,
			}),
		)
	})
	.post('/', vValidator('json', RackCreateSchema, onValidationError), (c) => {
		const result = createRack(c.req.valid('json'))
		if (Result.isOk(result)) {
			return c.json(result.value, 201)
		}
		return sendResult(c, result)
	})
	.get('/:id/elevation', vValidator('param', EntityParamsSchema, onValidationError), (c) => {
		return sendResult(c, getElevation(c.req.valid('param').id))
	})
	.get('/:id', vValidator('param', EntityParamsSchema, onValidationError), (c) => {
		return sendResult(c, getRack(c.req.valid('param').id))
	})
	.patch(
		'/:id',
		vValidator('param', EntityParamsSchema, onValidationError),
		vValidator('json', RackUpdateSchema, onValidationError),
		(c) => {
			const result = updateRack(c.req.valid('param').id, c.req.valid('json'))
			if (Result.isOk(result)) {
				return c.json(result.value)
			}
			return sendResult(c, result)
		},
	)
	.delete('/:id', vValidator('param', EntityParamsSchema, onValidationError), (c) => {
		const result = deleteRack(c.req.valid('param').id)
		if (Result.isOk(result)) {
			return c.json(result.value)
		}
		return sendResult(c, result)
	})
