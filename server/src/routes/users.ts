import { vValidator } from '@hono/valibot-validator'
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
import { requireAdminMiddleware } from '../middleware/roles'
import { onValidationError } from '../middleware/validation'
import { sendCreated, sendRow } from './helpers'

/**
 * User management: admin-only. Admins create accounts with an explicit
 * role, change roles, (re)scope editors/viewers to a single tenant, reset
 * passwords, and delete accounts. The last admin account can neither be
 * demoted nor deleted, and nobody can delete their own account
 * (enforced in `db/users.ts`).
 */
export const usersApp = new Hono()
	.use(authMiddleware)
	.use(requireAdminMiddleware)
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
		return sendCreated(c, await createUser(c.req.valid('json')))
	})
	.get('/:id', vValidator('param', EntityParamsSchema, onValidationError), (c) => {
		return sendRow(c, getUserResult(c.req.valid('param').id))
	})
	.patch(
		'/:id',
		vValidator('param', EntityParamsSchema, onValidationError),
		vValidator('json', UserUpdateSchema, onValidationError),
		async (c) => {
			return sendRow(c, await updateUser(c.req.valid('param').id, c.req.valid('json')))
		},
	)
	.delete('/:id', vValidator('param', EntityParamsSchema, onValidationError), (c) => {
		return sendRow(c, deleteUser(c.req.valid('param').id, requestUser(c).id))
	})
