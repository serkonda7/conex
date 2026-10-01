import { vValidator } from '@hono/valibot-validator'
import { Hono } from 'hono'
import { ChangelogListQuerySchema, EntityParamsSchema } from 'shared/src/schemas'
import { listTenantScope, sendTenantRow } from '../authz'
import { getObjectChange, listChangelog } from '../db/changelog'
import { authMiddleware } from '../middleware/auth'
import { requirePermissionMiddleware } from '../middleware/permissions'
import { onValidationError } from '../middleware/validation'
import { sendRow } from './helpers'

/**
 * Changelog: `changelog.view`, read-only. Every entry carries the tenant of its object, so
 * tenant-scoped users see their own tenant's changes only (no catalog or
 * cross-tenant entries); global users see all and may narrow by
 * `?tenant=` / `?tenant_group=`. Entries are written by the service layer
 * (`db/changelog.ts`).
 */
export const changelogApp = new Hono()
	.use(authMiddleware)
	.use(requirePermissionMiddleware('changelog.view'))
	.get('/', vValidator('query', ChangelogListQuerySchema, onValidationError), async (c) => {
		const query = c.req.valid('query')
		const scope = await listTenantScope(c, query.tenant, query.tenant_group)
		if (scope instanceof Response) {
			return scope
		}
		return sendRow(
			c,
			await listChangelog({
				search: query.search,
				page: query.page,
				limit: query.limit,
				action: query.action,
				object_type: query.object_type,
				...scope,
			}),
		)
	})
	.get('/:id', vValidator('param', EntityParamsSchema, onValidationError), async (c) => {
		return sendTenantRow(c, await getObjectChange(c.req.valid('param').id))
	})
