import { vValidator } from '@hono/valibot-validator'
import { Result } from 'better-result'
import { type Context, Hono } from 'hono'
import {
	type AuditRoleDetail,
	EntityParamsSchema,
	type Permission,
	RoleCreateSchema,
	type RoleJson,
	RoleListQuerySchema,
	RoleUpdateSchema,
} from 'shared/src/schemas'
import { requestUser } from '../authz'
import { createRole, deleteRole, getRole, listRoles, updateRole } from '../db/roles'
import { authMiddleware } from '../middleware/auth'
import { requirePermissionMiddleware } from '../middleware/permissions'
import { onValidationError } from '../middleware/validation'
import { auditRequest } from '../util/audit'
import { sendCreated, sendResult } from '../util/result_response'
import { listQueryParams } from './crud'

async function auditRole(
	c: Context,
	event: 'role.create' | 'role.update' | 'role.delete',
	detail: AuditRoleDetail,
): Promise<void> {
	const actor = requestUser(c)
	await auditRequest(c, { event, username: actor.username, user_id: actor.id, detail })
}

/** Permissions in `a` but not in `b`. */
function without(a: Permission[], b: Permission[]): Permission[] {
	return a.filter((p) => !b.includes(p))
}

/** Rename and permission changes of an update; null when neither changed. */
function roleChange(before: RoleJson, after: RoleJson): AuditRoleDetail | null {
	const added = without(after.permissions, before.permissions)
	const removed = without(before.permissions, after.permissions)
	const renamed = before.name !== after.name
	if (!renamed && added.length === 0 && removed.length === 0) {
		return null
	}
	return {
		role_id: after.id,
		role_name: after.name,
		...(renamed ? { renamed_from: before.name } : {}),
		...(added.length > 0 ? { added } : {}),
		...(removed.length > 0 ? { removed } : {}),
	}
}

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
			await listRoles({
				...listQueryParams(query),
			}),
		)
	})
	.post('/', vValidator('json', RoleCreateSchema, onValidationError), async (c) => {
		const res = await createRole(c.req.valid('json'))
		if (Result.isOk(res)) {
			await auditRole(c, 'role.create', {
				role_id: res.value.id,
				role_name: res.value.name,
				added: res.value.permissions,
			})
		}
		return sendCreated(c, res)
	})
	.get('/:id', vValidator('param', EntityParamsSchema, onValidationError), async (c) => {
		return sendResult(c, await getRole(c.req.valid('param').id))
	})
	.patch(
		'/:id',
		vValidator('param', EntityParamsSchema, onValidationError),
		vValidator('json', RoleUpdateSchema, onValidationError),
		async (c) => {
			const id = c.req.valid('param').id
			const before = await getRole(id)
			const res = await updateRole(id, c.req.valid('json'))
			const change =
				Result.isOk(before) && Result.isOk(res) ? roleChange(before.value, res.value) : null
			if (change) {
				await auditRole(c, 'role.update', change)
			}
			return sendResult(c, res)
		},
	)
	.delete('/:id', vValidator('param', EntityParamsSchema, onValidationError), async (c) => {
		const res = await deleteRole(c.req.valid('param').id)
		if (Result.isOk(res)) {
			await auditRole(c, 'role.delete', {
				role_id: res.value.id,
				role_name: res.value.name,
				removed: res.value.permissions,
			})
		}
		return sendResult(c, res)
	})
