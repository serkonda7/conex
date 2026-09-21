import { vValidator } from '@hono/valibot-validator'
import { Result } from 'better-result'
import { Hono } from 'hono'
import {
	EntityParamsSchema,
	TenantCreateSchema,
	TenantListQuerySchema,
	TenantUpdateSchema,
} from 'shared/src/schemas'
import { checkRead, requestUser, requireWrite, scopeTenantId } from '../authz'
import { ForbiddenError } from '../db/errors'
import { createTenant, deleteTenant, getTenant, listTenants, updateTenant } from '../db/tenancy'
import { authMiddleware } from '../middleware/auth'
import { onValidationError } from '../middleware/validation'
import { sendResult } from '../util/result_response'

/**
 * Tenants are the scope boundary itself: scoped editors/viewers see exactly
 * their own tenant row and cannot create, rename, or delete tenants — only
 * global editors/admins may reshape the boundary (a scoped editor creating
 * tenants could otherwise escape its own scope).
 */
export const tenantsApp = new Hono()
	.use(authMiddleware)
	.get('/', vValidator('query', TenantListQuerySchema, onValidationError), (c) => {
		const query = c.req.valid('query')
		const scope = scopeTenantId(requestUser(c))
		return c.json(
			listTenants({
				search: query.search,
				page: query.page,
				limit: query.limit,
				sort: query.sort,
				order: query.order,
				...(scope !== null ? { scopeTenantId: scope } : {}),
			}),
		)
	})
	.post('/', vValidator('json', TenantCreateSchema, onValidationError), (c) => {
		const denied = requireWrite(c)
		if (denied) {
			return denied
		}
		if (scopeTenantId(requestUser(c)) !== null) {
			return sendResult(
				c,
				Result.err(new ForbiddenError('Tenant-scoped users cannot create tenants')),
			)
		}
		const result = createTenant(c.req.valid('json'))
		if (Result.isOk(result)) {
			return c.json(result.value, 201)
		}
		return sendResult(c, result)
	})
	.get('/:id', vValidator('param', EntityParamsSchema, onValidationError), (c) => {
		const result = getTenant(c.req.valid('param').id)
		if (Result.isError(result)) {
			return sendResult(c, result)
		}
		// A tenant row is "its own" tenant: scoped requesters see only theirs.
		const denied = checkRead(c, result.value.id)
		if (denied) {
			return denied
		}
		return c.json(result.value)
	})
	.patch(
		'/:id',
		vValidator('param', EntityParamsSchema, onValidationError),
		vValidator('json', TenantUpdateSchema, onValidationError),
		(c) => {
			const denied = requireWrite(c)
			if (denied) {
				return denied
			}
			if (scopeTenantId(requestUser(c)) !== null) {
				return sendResult(
					c,
					Result.err(new ForbiddenError('Tenant-scoped users cannot rename tenants')),
				)
			}
			const result = updateTenant(c.req.valid('param').id, c.req.valid('json'))
			if (Result.isOk(result)) {
				return c.json(result.value)
			}
			return sendResult(c, result)
		},
	)
	.delete('/:id', vValidator('param', EntityParamsSchema, onValidationError), (c) => {
		const denied = requireWrite(c)
		if (denied) {
			return denied
		}
		if (scopeTenantId(requestUser(c)) !== null) {
			return sendResult(
				c,
				Result.err(new ForbiddenError('Tenant-scoped users cannot delete tenants')),
			)
		}
		const result = deleteTenant(c.req.valid('param').id)
		if (Result.isOk(result)) {
			return c.json(result.value)
		}
		return sendResult(c, result)
	})
