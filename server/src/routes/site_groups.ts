import { vValidator } from '@hono/valibot-validator'
import { Result } from 'better-result'
import { Hono } from 'hono'
import {
	EntityParamsSchema,
	SiteGroupCreateSchema,
	SiteGroupListQuerySchema,
	SiteGroupUpdateSchema,
} from 'shared/src/schemas'
import {
	createSiteGroup,
	deleteSiteGroup,
	getSiteGroup,
	listSiteGroups,
	updateSiteGroup,
} from '../db/tenancy'
import { authMiddleware } from '../middleware/auth'
import { onValidationError } from '../middleware/validation'
import { sendResult } from '../util/result_response'

export const siteGroupsApp = new Hono()
	.use(authMiddleware)
	.get('/', vValidator('query', SiteGroupListQuerySchema, onValidationError), (c) => {
		const query = c.req.valid('query')
		return c.json(
			listSiteGroups({
				search: query.search,
				page: query.page,
				limit: query.limit,
				parent: query.parent,
				sort: query.sort,
				order: query.order,
			}),
		)
	})
	.post('/', vValidator('json', SiteGroupCreateSchema, onValidationError), (c) => {
		const result = createSiteGroup(c.req.valid('json'))
		if (Result.isOk(result)) {
			return c.json(result.value, 201)
		}
		return sendResult(c, result)
	})
	.get('/:id', vValidator('param', EntityParamsSchema, onValidationError), (c) => {
		return sendResult(c, getSiteGroup(c.req.valid('param').id))
	})
	.patch(
		'/:id',
		vValidator('param', EntityParamsSchema, onValidationError),
		vValidator('json', SiteGroupUpdateSchema, onValidationError),
		(c) => {
			const result = updateSiteGroup(c.req.valid('param').id, c.req.valid('json'))
			if (Result.isOk(result)) {
				return c.json(result.value)
			}
			return sendResult(c, result)
		},
	)
	.delete('/:id', vValidator('param', EntityParamsSchema, onValidationError), (c) => {
		const result = deleteSiteGroup(c.req.valid('param').id)
		if (Result.isOk(result)) {
			return c.json(result.value)
		}
		return sendResult(c, result)
	})
