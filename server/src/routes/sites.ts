import { vValidator } from '@hono/valibot-validator'
import { Result } from 'better-result'
import { Hono } from 'hono'
import {
	EntityParamsSchema,
	SiteCreateSchema,
	SiteListQuerySchema,
	SiteUpdateSchema,
} from 'shared/src/schemas'
import {
	guardUpdate,
	guardWrite,
	listTenantScope,
	requireWrite,
	resolveCreateTenant,
	sendTenantRow,
} from '../authz'
import { createSite, deleteSite, getSite, listSites, updateSite } from '../db/tenancy'
import { authMiddleware } from '../middleware/auth'
import { onValidationError } from '../middleware/validation'
import { sendResult } from '../util/result_response'

export const sitesApp = new Hono()
	.use(authMiddleware)
	.get('/', vValidator('query', SiteListQuerySchema, onValidationError), (c) => {
		const query = c.req.valid('query')
		const scope = listTenantScope(c, query.tenant)
		if (scope instanceof Response) {
			return scope
		}
		return c.json(
			listSites({
				search: query.search,
				page: query.page,
				limit: query.limit,
				group: query.group,
				sort: query.sort,
				order: query.order,
				...scope,
			}),
		)
	})
	.post('/', vValidator('json', SiteCreateSchema, onValidationError), (c) => {
		const denied = requireWrite(c)
		if (denied) {
			return denied
		}
		const body = c.req.valid('json')
		const tenant = resolveCreateTenant(c, body.tenant_id)
		if (tenant instanceof Response) {
			return tenant
		}
		const result = createSite({ ...body, tenant_id: tenant })
		if (Result.isOk(result)) {
			return c.json(result.value, 201)
		}
		return sendResult(c, result)
	})
	.get('/:id', vValidator('param', EntityParamsSchema, onValidationError), (c) => {
		return sendTenantRow(c, getSite(c.req.valid('param').id))
	})
	.patch(
		'/:id',
		vValidator('param', EntityParamsSchema, onValidationError),
		vValidator('json', SiteUpdateSchema, onValidationError),
		(c) => {
			const id = c.req.valid('param').id
			const body = c.req.valid('json')
			const current = getSite(id)
			if (Result.isError(current)) {
				return sendResult(c, current)
			}
			const denied = guardUpdate(c, current.value.tenant_id, body.tenant_id)
			if (denied) {
				return denied
			}
			const result = updateSite(id, body)
			if (Result.isOk(result)) {
				return c.json(result.value)
			}
			return sendResult(c, result)
		},
	)
	.delete('/:id', vValidator('param', EntityParamsSchema, onValidationError), (c) => {
		const id = c.req.valid('param').id
		const current = getSite(id)
		if (Result.isError(current)) {
			return sendResult(c, current)
		}
		const denied = guardWrite(c, current.value.tenant_id)
		if (denied) {
			return denied
		}
		const result = deleteSite(id)
		if (Result.isOk(result)) {
			return c.json(result.value)
		}
		return sendResult(c, result)
	})
