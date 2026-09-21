import { vValidator } from '@hono/valibot-validator'
import { Hono } from 'hono'
import { SearchQuerySchema } from 'shared/src/schemas'
import { requestUser, scopeTenantId } from '../authz'
import { globalSearch } from '../db/search'
import { authMiddleware } from '../middleware/auth'
import { onValidationError } from '../middleware/validation'

/** Global search across tenants/sites/racks/devices/cables (grouped hits). */
export const searchApp = new Hono()
	.use(authMiddleware)
	.get('/', vValidator('query', SearchQuerySchema, onValidationError), (c) => {
		const scope = scopeTenantId(requestUser(c))
		return c.json(globalSearch(c.req.valid('query').q, scope ?? undefined))
	})
