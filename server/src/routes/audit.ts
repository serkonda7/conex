import { vValidator } from '@hono/valibot-validator'
import { Hono } from 'hono'
import { AuditListQuerySchema } from 'shared/src/schemas'
import { listAuditLogs } from '../audit'
import { authMiddleware } from '../middleware/auth'
import { onValidationError } from '../middleware/validation'

/** Audit log list (`?search=&page=&limit=`), newest first. */
export const auditApp = new Hono()
	.use(authMiddleware)
	.get('/', vValidator('query', AuditListQuerySchema, onValidationError), (c) => {
		const query = c.req.valid('query')
		return c.json(listAuditLogs({ search: query.search, page: query.page, limit: query.limit }))
	})
