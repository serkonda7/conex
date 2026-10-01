import { vValidator } from '@hono/valibot-validator'
import { Hono } from 'hono'
import { AuditLogListQuerySchema } from 'shared/src/schemas'
import { listAuditLog } from '../db/audit'
import { authMiddleware } from '../middleware/auth'
import { requireAdminMiddleware } from '../middleware/roles'
import { onValidationError } from '../middleware/validation'
import { sendRow } from './helpers'

/** Audit log: admin-only, read-only. Entries are written by the auth routes. */
export const auditLogApp = new Hono()
	.use(authMiddleware)
	.use(requireAdminMiddleware)
	.get('/', vValidator('query', AuditLogListQuerySchema, onValidationError), async (c) => {
		const query = c.req.valid('query')
		return sendRow(
			c,
			await listAuditLog({
				search: query.search,
				page: query.page,
				limit: query.limit,
				event: query.event,
			}),
		)
	})
