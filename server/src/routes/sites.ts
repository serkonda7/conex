import { vValidator } from '@hono/valibot-validator'
import { Result } from 'better-result'
import { Hono } from 'hono'
import {
	EntityParamsSchema,
	SiteCreateSchema,
	SiteListQuerySchema,
	SiteUpdateSchema,
} from 'shared/src/schemas'
import { createSite, deleteSite, getSite, listSites, updateSite } from '../db/tenancy'
import { authMiddleware } from '../middleware/auth'
import { onValidationError } from '../middleware/validation'
import { sendResult } from '../util/result_response'

export const sitesApp = new Hono()
	.use(authMiddleware)
	.get('/', vValidator('query', SiteListQuerySchema, onValidationError), (c) => {
		const query = c.req.valid('query')
		return c.json(
			listSites({
				search: query.search,
				page: query.page,
				limit: query.limit,
				tenant: query.tenant,
			}),
		)
	})
	.post('/', vValidator('json', SiteCreateSchema, onValidationError), (c) => {
		const result = createSite(c.req.valid('json'))
		if (Result.isOk(result)) {
			return c.json(result.value, 201)
		}
		return sendResult(c, result)
	})
	.get('/:id', vValidator('param', EntityParamsSchema, onValidationError), (c) => {
		return sendResult(c, getSite(c.req.valid('param').id))
	})
	.patch(
		'/:id',
		vValidator('param', EntityParamsSchema, onValidationError),
		vValidator('json', SiteUpdateSchema, onValidationError),
		(c) => {
			const result = updateSite(c.req.valid('param').id, c.req.valid('json'))
			if (Result.isOk(result)) {
				return c.json(result.value)
			}
			return sendResult(c, result)
		},
	)
	.delete('/:id', vValidator('param', EntityParamsSchema, onValidationError), (c) => {
		const result = deleteSite(c.req.valid('param').id)
		if (Result.isOk(result)) {
			return c.json(result.value)
		}
		return sendResult(c, result)
	})
