import { vValidator } from '@hono/valibot-validator'
import { Hono } from 'hono'
import { InterfaceListQuerySchema } from 'shared/src/schemas'
import { checkRead, deviceTenant, requestUser, scopeTenantId } from '../authz'
import { listAllInterfaces } from '../db/devices'
import { authMiddleware } from '../middleware/auth'
import { onValidationError } from '../middleware/validation'

/**
 * Global interface list across devices. Interfaces carry no tenant of their
 * own: every gate follows the parent device (`deviceTenant`), and listing is
 * scope-filtered in SQL so scoped users see only their own tenant's ports.
 */
export const interfacesApp = new Hono()
	.use(authMiddleware)
	.get('/', vValidator('query', InterfaceListQuerySchema, onValidationError), (c) => {
		const query = c.req.valid('query')
		if (query.device !== undefined) {
			const tenant = deviceTenant(query.device)
			if (tenant !== undefined) {
				const denied = checkRead(c, tenant)
				if (denied) {
					return denied
				}
			}
		}
		const scope = scopeTenantId(requestUser(c))
		return c.json(
			listAllInterfaces({
				search: query.search,
				page: query.page,
				limit: query.limit,
				device: query.device,
				connected: query.connected,
				...(scope !== null ? { scopeTenantId: scope } : {}),
			}),
		)
	})
