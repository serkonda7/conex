import { vValidator } from '@hono/valibot-validator'
import { Hono } from 'hono'
import { TopologyQuerySchema } from 'shared/src/schemas'
import { checkTenant, listTenantScope } from '../authz'
import { deviceTenant } from '../db/owners'
import { getTopology } from '../db/topology'
import { authMiddleware } from '../middleware/auth'
import { requirePermissionMiddleware } from '../middleware/permissions'
import { onValidationError } from '../middleware/validation'

/**
 * Device-graph snapshot for the topology view: every visible device is a
 * node, every visible cable an edge. `?tenant=`/`?tenant_group=`/
 * `?group=`/`?site=` narrow the
 * snapshot to one site group/site (edges need both ends inside).
 * Scoped editors/viewers see only their own tenant's subgraph (both cable
 * ends must sit in the scope tenant). `?device=` keeps the connected
 * component containing that device and answers 403 when it names a device
 * outside the requester's scope.
 */
export const topologyApp = new Hono()
	.use(authMiddleware)
	.use(requirePermissionMiddleware('view'))
	.get('/', vValidator('query', TopologyQuerySchema, onValidationError), async (c) => {
		const query = c.req.valid('query')
		if (query.device !== undefined) {
			const denied = checkTenant(c, await deviceTenant(query.device))
			if (denied) {
				return denied
			}
		}
		const scope = await listTenantScope(c, query.tenant, query.tenant_group)
		if (scope instanceof Response) {
			return scope
		}
		return c.json(
			await getTopology({
				site: query.site,
				device: query.device,
				group: query.group,
				...scope,
			}),
		)
	})
