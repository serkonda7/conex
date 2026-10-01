import { vValidator } from '@hono/valibot-validator'
import { Result } from 'better-result'
import { Hono } from 'hono'
import {
	EntityParamsSchema,
	TenantGroupCreateSchema,
	TenantGroupListQuerySchema,
	TenantGroupUpdateSchema,
} from 'shared/src/schemas'
import { requestUser, scopeTenantId } from '../authz'
import { ForbiddenError } from '../db/errors'
import {
	createTenantGroup,
	deleteTenantGroup,
	getTenant,
	getTenantGroup,
	listTenantGroups,
	updateTenantGroup,
} from '../db/tenancy'
import { authMiddleware } from '../middleware/auth'
import {
	requireGlobalPermissionMiddleware,
	requirePermissionMiddleware,
} from '../middleware/permissions'
import { onValidationError } from '../middleware/validation'
import { sendResult } from '../util/result_response'
import { sendCreated, sendRow } from './helpers'

/**
 * Tenant groups bundle tenants for selection; they own no inventory.
 * Like tenants, only global editors/admins may reshape them. Scoped
 * editors/viewers see just the group containing their own tenant.
 */
export const tenantGroupsApp = new Hono()
	.use(authMiddleware)
	.use(requirePermissionMiddleware('view'))
	.get('/', vValidator('query', TenantGroupListQuerySchema, onValidationError), async (c) => {
		const query = c.req.valid('query')
		const scope = scopeTenantId(requestUser(c))
		return c.json(
			await listTenantGroups({
				search: query.search,
				page: query.page,
				limit: query.limit,
				sort: query.sort,
				order: query.order,
				...(scope !== null ? { scopeTenantId: scope } : {}),
			}),
		)
	})
	.post(
		'/',
		requireGlobalPermissionMiddleware('edit'),
		vValidator('json', TenantGroupCreateSchema, onValidationError),
		async (c) => sendCreated(c, await createTenantGroup(c.req.valid('json'))),
	)
	.get('/:id', vValidator('param', EntityParamsSchema, onValidationError), async (c) => {
		const result = await getTenantGroup(c.req.valid('param').id)
		if (Result.isError(result)) {
			return sendResult(c, result)
		}
		const scope = scopeTenantId(requestUser(c))
		if (scope !== null) {
			const own = await getTenant(scope)
			if (Result.isError(own) || own.value.tenant_group_id !== result.value.id) {
				return sendResult(
					c,
					Result.err(new ForbiddenError('Forbidden: outside your tenant scope')),
				)
			}
		}
		return c.json(result.value)
	})
	.patch(
		'/:id',
		requireGlobalPermissionMiddleware('edit'),
		vValidator('param', EntityParamsSchema, onValidationError),
		vValidator('json', TenantGroupUpdateSchema, onValidationError),
		async (c) =>
			sendRow(c, await updateTenantGroup(c.req.valid('param').id, c.req.valid('json'))),
	)
	.delete(
		'/:id',
		requireGlobalPermissionMiddleware('delete'),
		vValidator('param', EntityParamsSchema, onValidationError),
		async (c) => sendRow(c, await deleteTenantGroup(c.req.valid('param').id)),
	)
