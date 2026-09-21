import { vValidator } from '@hono/valibot-validator'
import { Result } from 'better-result'
import { Hono } from 'hono'
import {
	EntityParamsSchema,
	UserCreateSchema,
	UserListQuerySchema,
	UserUpdateSchema,
} from 'shared/src/schemas'
import { requestUser, requireAdmin } from '../authz'
import { createUser, deleteUser, getUserResult, listUsers, updateUser } from '../db/users'
import { authMiddleware } from '../middleware/auth'
import { onValidationError } from '../middleware/validation'
import { sendResult } from '../util/result_response'

/**
 * User management: admin-only. Admins create accounts with an explicit
 * role, change roles, (re)scope editors/viewers to a single tenant, reset
 * passwords, and delete accounts. The last admin account can neither be
 * demoted nor deleted, and nobody can delete their own account
 * (enforced in `db/users.ts`).
 */
export const usersApp = new Hono()
	.use(authMiddleware)
	.use(async (c, next) => {
		const denied = requireAdmin(c)
		if (denied) {
			return denied
		}
		await next()
	})
	.get('/', vValidator('query', UserListQuerySchema, onValidationError), (c) => {
		const query = c.req.valid('query')
		return c.json(
			listUsers({
				search: query.search,
				page: query.page,
				limit: query.limit,
				role: query.role,
				tenant: query.tenant,
			}),
		)
	})
	.post('/', vValidator('json', UserCreateSchema, onValidationError), async (c) => {
		const result = await createUser(c.req.valid('json'))
		if (Result.isOk(result)) {
			return c.json(result.value, 201)
		}
		return sendResult(c, result)
	})
	.get('/:id', vValidator('param', EntityParamsSchema, onValidationError), (c) => {
		return sendResult(c, getUserResult(c.req.valid('param').id))
	})
	.patch(
		'/:id',
		vValidator('param', EntityParamsSchema, onValidationError),
		vValidator('json', UserUpdateSchema, onValidationError),
		async (c) => {
			const result = await updateUser(c.req.valid('param').id, c.req.valid('json'))
			if (Result.isOk(result)) {
				return c.json(result.value)
			}
			return sendResult(c, result)
		},
	)
	.delete('/:id', vValidator('param', EntityParamsSchema, onValidationError), (c) => {
		const result = deleteUser(c.req.valid('param').id, requestUser(c).id)
		if (Result.isOk(result)) {
			return c.json(result.value)
		}
		return sendResult(c, result)
	})
