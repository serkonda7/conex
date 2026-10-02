import { vValidator } from '@hono/valibot-validator'
import { Result } from 'better-result'
import { Hono } from 'hono'
import {
	EntityParamsSchema,
	TenantGroupCreateSchema,
	TenantGroupListQuerySchema,
	TenantGroupUpdateSchema,
} from 'shared/src/schemas'
import { forbidden, requestScope } from '../authz'
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
import { sendCreated, sendResult } from '../util/result_response'

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
		return c.json(
			await listTenantGroups({
				search: query.search,
				page: query.page,
				limit: query.limit,
				sort: query.sort,
				order: query.order,
				scopeTenantId: requestScope(c),
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
		const scope = requestScope(c)
		if (scope !== undefined) {
			const own = await getTenant(scope)
			if (Result.isError(own) || own.value.tenant_group_id !== result.value.id) {
				return forbidden(c)
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
			sendResult(c, await updateTenantGroup(c.req.valid('param').id, c.req.valid('json'))),
	)
	.delete(
		'/:id',
		requireGlobalPermissionMiddleware('delete'),
		vValidator('param', EntityParamsSchema, onValidationError),
		async (c) => sendResult(c, await deleteTenantGroup(c.req.valid('param').id)),
	)
