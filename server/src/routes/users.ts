import { vValidator } from '@hono/valibot-validator'
import { Result } from 'better-result'
import { type Context, Hono } from 'hono'
import {
	EntityParamsSchema,
	UserCreateSchema,
	type UserJson,
	UserListQuerySchema,
	UserUpdateSchema,
} from 'shared/src/schemas'
import { requestUser } from '../authz'
import { createUser, deleteUser, getUserResult, listUsers, updateUser } from '../db/users'
import { authMiddleware } from '../middleware/auth'
import { requirePermissionMiddleware } from '../middleware/permissions'
import { onValidationError } from '../middleware/validation'
import { invalidateUserSessions } from '../sessions'
import { auditRequest } from '../util/audit'
import { sendCreated, sendResult } from '../util/result_response'
import { listQueryParams } from './crud'

/** Records the role `user` holds now; `fromRole` is null for a new account. */
async function auditRoleChange(c: Context, user: UserJson, fromRole: string | null): Promise<void> {
	const actor = requestUser(c)
	await auditRequest(c, {
		event: 'user.role_change',
		username: actor.username,
		user_id: actor.id,
		detail: { target_username: user.username, from_role: fromRole, to_role: user.role_name },
	})
}

/**
 * User management (`users.manage`): create accounts with a role, link them
 * to an employee, change roles, (re)scope users to a single tenant of their
 * employee, reset passwords, and delete
 * accounts. The last global user able to manage users can neither lose
 * that permission nor be deleted, and nobody can delete their own account
 * (enforced in `db/users.ts`).
 */
export const usersApp = new Hono()
	.use(authMiddleware)
	.use(requirePermissionMiddleware('users.manage'))
	.get('/', vValidator('query', UserListQuerySchema, onValidationError), async (c) => {
		const query = c.req.valid('query')
		return c.json(
			await listUsers({
				...listQueryParams(query),
				role: query.role,
				tenant: query.tenant,
				employee: query.employee,
			}),
		)
	})
	.post('/', vValidator('json', UserCreateSchema, onValidationError), async (c) => {
		const res = await createUser(c.req.valid('json'))
		if (Result.isOk(res)) {
			await auditRoleChange(c, res.value, null)
		}
		return sendCreated(c, res)
	})
	.get('/:id', vValidator('param', EntityParamsSchema, onValidationError), async (c) => {
		return sendResult(c, await getUserResult(c.req.valid('param').id))
	})
	.patch(
		'/:id',
		vValidator('param', EntityParamsSchema, onValidationError),
		vValidator('json', UserUpdateSchema, onValidationError),
		async (c) => {
			const input = c.req.valid('json')
			const id = c.req.valid('param').id
			const before = input.role_id !== undefined ? await getUserResult(id) : undefined
			const res = await updateUser(id, input)
			if (Result.isOk(res) && before && Result.isOk(before)) {
				if (before.value.role_id !== res.value.role_id) {
					await auditRoleChange(c, res.value, before.value.role_name)
				}
			}
			if (Result.isOk(res) && input.password !== undefined) {
				// A reset signs the account out everywhere except the actor's own session.
				const actor = requestUser(c)
				await invalidateUserSessions(res.value.id, c.get('jwtPayload').jti)
				await auditRequest(c, {
					event: 'password.reset',
					username: actor.username,
					user_id: actor.id,
					detail: { target_username: res.value.username },
				})
			}
			return sendResult(c, res)
		},
	)
	.delete('/:id', vValidator('param', EntityParamsSchema, onValidationError), async (c) => {
		return sendResult(c, await deleteUser(c.req.valid('param').id, requestUser(c).id))
	})
