import { vValidator } from '@hono/valibot-validator'
import { Result } from 'better-result'
import { Hono } from 'hono'
import {
	EntityParamsSchema,
	UserCreateSchema,
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

/**
 * User management (`users.manage`): create accounts with a role, change
 * roles, (re)scope users to a single tenant, reset passwords, and delete
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
				search: query.search,
				page: query.page,
				limit: query.limit,
				role: query.role,
				tenant: query.tenant,
			}),
		)
	})
	.post('/', vValidator('json', UserCreateSchema, onValidationError), async (c) => {
		return sendCreated(c, await createUser(c.req.valid('json')))
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
			const res = await updateUser(c.req.valid('param').id, input)
			if (Result.isOk(res) && input.password !== undefined) {
				// A reset signs the account out everywhere except the actor's own session.
				const actor = requestUser(c)
				await invalidateUserSessions(res.value.id, c.get('jwtPayload').jti)
				await auditRequest(c, {
					event: 'password.reset',
					username: actor.username,
					user_id: actor.id,
					target_username: res.value.username,
				})
			}
			return sendResult(c, res)
		},
	)
	.delete('/:id', vValidator('param', EntityParamsSchema, onValidationError), async (c) => {
		return sendResult(c, await deleteUser(c.req.valid('param').id, requestUser(c).id))
	})
