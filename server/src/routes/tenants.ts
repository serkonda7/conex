import { vValidator } from '@hono/valibot-validator'
import { Result } from 'better-result'
import { Hono } from 'hono'
import {
	EntityParamsSchema,
	TenantCreateSchema,
	TenantListQuerySchema,
	TenantUpdateSchema,
} from 'shared/src/schemas'
import { checkTenant, requestScope, requireGlobalScope } from '../authz'
import { createTenant, deleteTenant, getTenant, listTenants, updateTenant } from '../db/tenancy'
import { authMiddleware } from '../middleware/auth'
import { requirePermissionMiddleware } from '../middleware/permissions'
import { onValidationError } from '../middleware/validation'
import { sendCreated, sendResult } from '../util/result_response'

/**
 * Tenants are the scope boundary itself: scoped editors/viewers see exactly
 * their own tenant row and cannot create, rename, or delete tenants — only
 * global editors/admins may reshape the boundary (a scoped editor creating
 * tenants could otherwise escape its own scope).
 */
export const tenantsApp = new Hono()
	.use(authMiddleware)
	.use(requirePermissionMiddleware('view'))
	.get('/', vValidator('query', TenantListQuerySchema, onValidationError), async (c) => {
		const query = c.req.valid('query')
		return c.json(
			await listTenants({
				search: query.search,
				page: query.page,
				limit: query.limit,
				group: query.group,
				sort: query.sort,
				order: query.order,
				scopeTenantId: requestScope(c),
			}),
		)
	})
	.post(
		'/',
		requirePermissionMiddleware('edit'),
		vValidator('json', TenantCreateSchema, onValidationError),
		async (c) => {
			return (
				requireGlobalScope(c, 'Tenant-scoped users cannot create tenants') ??
				sendCreated(c, await createTenant(c.req.valid('json')))
			)
		},
	)
	.get('/:id', vValidator('param', EntityParamsSchema, onValidationError), async (c) => {
		const result = await getTenant(c.req.valid('param').id)
		if (Result.isError(result)) {
			return sendResult(c, result)
		}
		// A tenant row is "its own" tenant: scoped requesters see only theirs.
		return checkTenant(c, result.value.id) ?? c.json(result.value)
	})
	.patch(
		'/:id',
		requirePermissionMiddleware('edit'),
		vValidator('param', EntityParamsSchema, onValidationError),
		vValidator('json', TenantUpdateSchema, onValidationError),
		async (c) => {
			return (
				requireGlobalScope(c, 'Tenant-scoped users cannot rename tenants') ??
				sendResult(c, await updateTenant(c.req.valid('param').id, c.req.valid('json')))
			)
		},
	)
	.delete(
		'/:id',
		requirePermissionMiddleware('delete'),
		vValidator('param', EntityParamsSchema, onValidationError),
		async (c) => {
			return (
				requireGlobalScope(c, 'Tenant-scoped users cannot delete tenants') ??
				sendResult(c, await deleteTenant(c.req.valid('param').id))
			)
		},
	)
