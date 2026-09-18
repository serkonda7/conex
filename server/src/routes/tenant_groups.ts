import { vValidator } from '@hono/valibot-validator'
import { Result } from 'better-result'
import { Hono } from 'hono'
import {
	EntityParamsSchema,
	TenantGroupCreateSchema,
	TenantGroupListQuerySchema,
	TenantGroupUpdateSchema,
} from 'shared/src/schemas'
import {
	createTenantGroup,
	deleteTenantGroup,
	getTenantGroup,
	listTenantGroups,
	updateTenantGroup,
} from '../db/tenancy'
import { authMiddleware } from '../middleware/auth'
import { onValidationError } from '../middleware/validation'
import { sendResult } from '../util/result_response'

export const tenantGroupsApp = new Hono()
	.use(authMiddleware)
	.get('/', vValidator('query', TenantGroupListQuerySchema, onValidationError), (c) => {
		const query = c.req.valid('query')
		return c.json(
			listTenantGroups({ search: query.search, page: query.page, limit: query.limit }),
		)
	})
	.post('/', vValidator('json', TenantGroupCreateSchema, onValidationError), (c) => {
		const result = createTenantGroup(c.req.valid('json'))
		if (Result.isOk(result)) {
			return c.json(result.value, 201)
		}
		return sendResult(c, result)
	})
	.get('/:id', vValidator('param', EntityParamsSchema, onValidationError), (c) => {
		return sendResult(c, getTenantGroup(c.req.valid('param').id))
	})
	.patch(
		'/:id',
		vValidator('param', EntityParamsSchema, onValidationError),
		vValidator('json', TenantGroupUpdateSchema, onValidationError),
		(c) => {
			const result = updateTenantGroup(c.req.valid('param').id, c.req.valid('json'))
			if (Result.isOk(result)) {
				return c.json(result.value)
			}
			return sendResult(c, result)
		},
	)
	.delete('/:id', vValidator('param', EntityParamsSchema, onValidationError), (c) => {
		const result = deleteTenantGroup(c.req.valid('param').id)
		if (Result.isOk(result)) {
			return c.json(result.value)
		}
		return sendResult(c, result)
	})
