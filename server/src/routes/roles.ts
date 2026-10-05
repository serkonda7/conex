import { vValidator } from '@hono/valibot-validator'
import { Hono } from 'hono'
import {
	EntityParamsSchema,
	RoleCreateSchema,
	RoleListQuerySchema,
	RoleUpdateSchema,
} from 'shared/src/schemas'
import { createRole, deleteRole, getRole, listRoles, updateRole } from '../db/roles'
import { authMiddleware } from '../middleware/auth'
import { requirePermissionMiddleware } from '../middleware/permissions'
import { onValidationError } from '../middleware/validation'
import { sendCreated, sendResult } from '../util/result_response'

/**
 * Role management (`users.manage`): named permission bundles assigned to
 * users. Roles in use cannot be deleted, and no edit may leave the
 * instance without a global user holding `users.manage` (enforced in
 * `db/roles.ts`).
 */
export const rolesApp = new Hono()
	.use(authMiddleware)
	.use(requirePermissionMiddleware('users.manage'))
	.get('/', vValidator('query', RoleListQuerySchema, onValidationError), async (c) => {
		const query = c.req.valid('query')
		return c.json(
			await listRoles({ search: query.search, page: query.page, limit: query.limit }),
		)
	})
	.post('/', vValidator('json', RoleCreateSchema, onValidationError), async (c) => {
		return sendCreated(c, await createRole(c.req.valid('json')))
	})
	.get('/:id', vValidator('param', EntityParamsSchema, onValidationError), async (c) => {
		return sendResult(c, await getRole(c.req.valid('param').id))
	})
	.patch(
		'/:id',
		vValidator('param', EntityParamsSchema, onValidationError),
		vValidator('json', RoleUpdateSchema, onValidationError),
		async (c) => {
			return sendResult(c, await updateRole(c.req.valid('param').id, c.req.valid('json')))
		},
	)
	.delete('/:id', vValidator('param', EntityParamsSchema, onValidationError), async (c) => {
		return sendResult(c, await deleteRole(c.req.valid('param').id))
	})
