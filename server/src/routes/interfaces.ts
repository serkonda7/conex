import { vValidator } from '@hono/valibot-validator'
import { Hono } from 'hono'
import { InterfaceListQuerySchema } from 'shared/src/schemas'
import { checkTenant, requestScope } from '../authz'
import { listAllInterfaces } from '../db/devices'
import { deviceTenant } from '../db/owners'
import { authMiddleware } from '../middleware/auth'
import { requirePermissionMiddleware } from '../middleware/permissions'
import { onValidationError } from '../middleware/validation'

/**
 * Global interface list across devices. Interfaces carry no tenant of their
 * own: every gate follows the parent device (`deviceTenant`), and listing is
 * scope-filtered in SQL so scoped users see only their own tenant's ports.
 */
export const interfacesApp = new Hono()
	.use(authMiddleware)
	.use(requirePermissionMiddleware('view'))
	.get('/', vValidator('query', InterfaceListQuerySchema, onValidationError), async (c) => {
		const query = c.req.valid('query')
		if (query.device !== undefined) {
			const denied = checkTenant(c, await deviceTenant(query.device))
			if (denied) {
				return denied
			}
		}
		return c.json(
			await listAllInterfaces({
				search: query.search,
				page: query.page,
				limit: query.limit,
				device: query.device,
				connected: query.connected,
				scopeTenantId: requestScope(c),
			}),
		)
	})
