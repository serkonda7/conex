import { vValidator } from '@hono/valibot-validator'
import { Hono } from 'hono'
import { TopologyQuerySchema } from 'shared/src/schemas'
import { checkListTenantParam, checkRead, deviceTenant, requestUser, scopeTenantId } from '../authz'
import { getTopology } from '../db/topology'
import { authMiddleware } from '../middleware/auth'
import { onValidationError } from '../middleware/validation'

/**
 * Device-graph snapshot for the topology view: every visible device is a
 * node, every visible cable an edge. `?group=`/`?site=` narrow the
 * snapshot to one site group/site (edges need both ends inside).
 * Scoped editors/viewers see only their own tenant's subgraph (both cable
 * ends must sit in the scope tenant). `?device=` keeps the connected
 * component containing that device and answers 403 when it names a device
 * outside the requester's scope.
 */
export const topologyApp = new Hono()
	.use(authMiddleware)
	.get('/', vValidator('query', TopologyQuerySchema, onValidationError), (c) => {
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
		const tenantDenied = checkListTenantParam(c, query.tenant)
		if (tenantDenied) {
			return tenantDenied
		}
		const scope = scopeTenantId(requestUser(c))
		return c.json(
			getTopology({
				site: query.site,
				device: query.device,
				tenant: query.tenant,
				group: query.group,
				...(scope !== null ? { scopeTenantId: scope } : {}),
			}),
		)
	})
