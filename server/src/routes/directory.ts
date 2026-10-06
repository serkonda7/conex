import { Hono } from 'hono'
import { requestScope } from '../authz'
import { listDirectoryContacts } from '../db/directory'
import { authMiddleware } from '../middleware/auth'
import { requirePermissionMiddleware } from '../middleware/permissions'

/** Read-only contact directory for telephony (AGFEO Dashboard LDAP plugin). */
export const directoryApp = new Hono()
	.use(authMiddleware)
	.use(requirePermissionMiddleware('contacts.directory'))
	.get('/contacts', async (c) => {
		return c.json(await listDirectoryContacts(requestScope(c)))
	})
