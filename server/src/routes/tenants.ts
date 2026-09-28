import { vValidator } from '@hono/valibot-validator'
import { Result } from 'better-result'
import { Hono } from 'hono'
import {
	EntityParamsSchema,
	TenantCreateSchema,
	TenantListQuerySchema,
	TenantUpdateSchema,
} from 'shared/src/schemas'
import { checkRead, requestUser, scopeTenantId } from '../authz'
import { ForbiddenError } from '../db/errors'
import { createTenant, deleteTenant, getTenant, listTenants, updateTenant } from '../db/tenancy'
import { authMiddleware } from '../middleware/auth'
import { requireWriteMiddleware } from '../middleware/roles'
import { onValidationError } from '../middleware/validation'
import { sendResult } from '../util/result_response'
import { sendCreated, sendRow } from './helpers'

/**
 * Tenants are the scope boundary itself: scoped editors/viewers see exactly
 * their own tenant row and cannot create, rename, or delete tenants — only
 * global editors/admins may reshape the boundary (a scoped editor creating
 * tenants could otherwise escape its own scope).
 */
export const tenantsApp = new Hono()
	.use(authMiddleware)
	.get('/', vValidator('query', TenantListQuerySchema, onValidationError), async (c) => {
		const query = c.req.valid('query')
		const scope = scopeTenantId(requestUser(c))
		return c.json(
			await listTenants({
				search: query.search,
				page: query.page,
				limit: query.limit,
				group: query.group,
				sort: query.sort,
				order: query.order,
				...(scope !== null ? { scopeTenantId: scope } : {}),
			}),
		)
	})
	.post(
		'/',
		requireWriteMiddleware,
		vValidator('json', TenantCreateSchema, onValidationError),
		async (c) => {
			if (scopeTenantId(requestUser(c)) !== null) {
				return sendResult(
					c,
					Result.err(new ForbiddenError('Tenant-scoped users cannot create tenants')),
				)
			}
			return sendCreated(c, await createTenant(c.req.valid('json')))
		},
	)
	.get('/:id', vValidator('param', EntityParamsSchema, onValidationError), async (c) => {
		const result = await getTenant(c.req.valid('param').id)
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
		requireWriteMiddleware,
		vValidator('param', EntityParamsSchema, onValidationError),
		vValidator('json', TenantUpdateSchema, onValidationError),
		async (c) => {
			if (scopeTenantId(requestUser(c)) !== null) {
				return sendResult(
					c,
					Result.err(new ForbiddenError('Tenant-scoped users cannot rename tenants')),
				)
			}
			return sendRow(c, await updateTenant(c.req.valid('param').id, c.req.valid('json')))
		},
	)
	.delete(
		'/:id',
		requireWriteMiddleware,
		vValidator('param', EntityParamsSchema, onValidationError),
		async (c) => {
			if (scopeTenantId(requestUser(c)) !== null) {
				return sendResult(
					c,
					Result.err(new ForbiddenError('Tenant-scoped users cannot delete tenants')),
				)
			}
			return sendRow(c, await deleteTenant(c.req.valid('param').id))
		},
	)
