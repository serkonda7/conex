import { vValidator } from '@hono/valibot-validator'
import { Result } from 'better-result'
import { Hono } from 'hono'
import {
	CableCreateSchema,
	CableListQuerySchema,
	CableUpdateSchema,
	EntityParamsSchema,
} from 'shared/src/schemas'
import { logAccess } from '../audit'
import { connectCable, deleteCable, getCable, listCables, updateCable } from '../db/cables'
import { authMiddleware } from '../middleware/auth'
import { onValidationError } from '../middleware/validation'
import { sendResult } from '../util/result_response'

export const cablesApp = new Hono()
	.use(authMiddleware)
	.get('/', vValidator('query', CableListQuerySchema, onValidationError), (c) => {
		const query = c.req.valid('query')
		return c.json(
			listCables({
				search: query.search,
				page: query.page,
				limit: query.limit,
				status: query.status,
				interface: query.interface,
				device: query.device,
			}),
		)
	})
	.post('/', vValidator('json', CableCreateSchema, onValidationError), (c) => {
		const result = connectCable(c.req.valid('json'))
		if (Result.isOk(result)) {
			logAccess(c, 'cable.create', result.value.id)
			return c.json(result.value, 201)
		}
		return sendResult(c, result)
	})
	.get('/:id', vValidator('param', EntityParamsSchema, onValidationError), (c) => {
		return sendResult(c, getCable(c.req.valid('param').id))
	})
	.patch(
		'/:id',
		vValidator('param', EntityParamsSchema, onValidationError),
		vValidator('json', CableUpdateSchema, onValidationError),
		(c) => {
			const result = updateCable(c.req.valid('param').id, c.req.valid('json'))
			if (Result.isOk(result)) {
				logAccess(c, 'cable.update', result.value.id)
				return c.json(result.value)
			}
			return sendResult(c, result)
		},
	)
	.delete('/:id', vValidator('param', EntityParamsSchema, onValidationError), (c) => {
		const result = deleteCable(c.req.valid('param').id)
		if (Result.isOk(result)) {
			logAccess(c, 'cable.delete', result.value.id)
			return c.json(result.value)
		}
		return sendResult(c, result)
	})
