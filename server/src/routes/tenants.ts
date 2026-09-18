import { vValidator } from '@hono/valibot-validator'
import { Result } from 'better-result'
import { Hono } from 'hono'
import {
	EntityParamsSchema,
	TenantCreateSchema,
	TenantListQuerySchema,
	TenantUpdateSchema,
} from 'shared/src/schemas'
import { createTenant, deleteTenant, getTenant, listTenants, updateTenant } from '../db/tenancy'
import { authMiddleware } from '../middleware/auth'
import { onValidationError } from '../middleware/validation'
import { sendResult } from '../util/result_response'

export const tenantsApp = new Hono()
	.use(authMiddleware)
	.get('/', vValidator('query', TenantListQuerySchema, onValidationError), (c) => {
		const query = c.req.valid('query')
		return c.json(
			listTenants({
				search: query.search,
				page: query.page,
				limit: query.limit,
				sort: query.sort,
				order: query.order,
			}),
		)
	})
	.post('/', vValidator('json', TenantCreateSchema, onValidationError), (c) => {
		const result = createTenant(c.req.valid('json'))
		if (Result.isOk(result)) {
			return c.json(result.value, 201)
		}
		return sendResult(c, result)
	})
	.get('/:id', vValidator('param', EntityParamsSchema, onValidationError), (c) => {
		return sendResult(c, getTenant(c.req.valid('param').id))
	})
	.patch(
		'/:id',
		vValidator('param', EntityParamsSchema, onValidationError),
		vValidator('json', TenantUpdateSchema, onValidationError),
		(c) => {
			const result = updateTenant(c.req.valid('param').id, c.req.valid('json'))
			if (Result.isOk(result)) {
				return c.json(result.value)
			}
			return sendResult(c, result)
		},
	)
	.delete('/:id', vValidator('param', EntityParamsSchema, onValidationError), (c) => {
		const result = deleteTenant(c.req.valid('param').id)
		if (Result.isOk(result)) {
			return c.json(result.value)
		}
		return sendResult(c, result)
	})
