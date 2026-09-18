import { vValidator } from '@hono/valibot-validator'
import { Result } from 'better-result'
import { Hono } from 'hono'
import {
	EntityParamsSchema,
	ShelfCreateSchema,
	ShelfListQuerySchema,
	ShelfUpdateSchema,
} from 'shared/src/schemas'
import { logAccess } from '../audit'
import { createShelf, deleteShelf, getShelf, listShelves, updateShelf } from '../db/racks'
import { authMiddleware } from '../middleware/auth'
import { onValidationError } from '../middleware/validation'
import { sendResult } from '../util/result_response'

export const shelvesApp = new Hono()
	.use(authMiddleware)
	.get('/', vValidator('query', ShelfListQuerySchema, onValidationError), (c) => {
		const query = c.req.valid('query')
		return c.json(
			listShelves({
				search: query.search,
				page: query.page,
				limit: query.limit,
				rack: query.rack,
			}),
		)
	})
	.post('/', vValidator('json', ShelfCreateSchema, onValidationError), (c) => {
		const result = createShelf(c.req.valid('json'))
		if (Result.isOk(result)) {
			logAccess(c, 'shelf.create', result.value.id)
			return c.json(result.value, 201)
		}
		return sendResult(c, result)
	})
	.get('/:id', vValidator('param', EntityParamsSchema, onValidationError), (c) => {
		return sendResult(c, getShelf(c.req.valid('param').id))
	})
	.patch(
		'/:id',
		vValidator('param', EntityParamsSchema, onValidationError),
		vValidator('json', ShelfUpdateSchema, onValidationError),
		(c) => {
			const result = updateShelf(c.req.valid('param').id, c.req.valid('json'))
			if (Result.isOk(result)) {
				logAccess(c, 'shelf.update', result.value.id)
				return c.json(result.value)
			}
			return sendResult(c, result)
		},
	)
	.delete('/:id', vValidator('param', EntityParamsSchema, onValidationError), (c) => {
		const result = deleteShelf(c.req.valid('param').id)
		if (Result.isOk(result)) {
			logAccess(c, 'shelf.delete', result.value.id)
			return c.json(result.value)
		}
		return sendResult(c, result)
	})
