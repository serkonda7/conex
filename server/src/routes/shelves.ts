import { vValidator } from '@hono/valibot-validator'
import { Result } from 'better-result'
import { type Context, Hono } from 'hono'
import {
	EntityParamsSchema,
	ShelfCreateSchema,
	ShelfListQuerySchema,
	ShelfUpdateSchema,
} from 'shared/src/schemas'
import { checkTenant, listTenantScope } from '../authz'
import { rackTenant, shelfTenant } from '../db/owners'
import {
	createShelf,
	deleteShelf,
	getShelf,
	listShelves,
	type ShelfRow,
	updateShelf,
} from '../db/shelves'
import { authMiddleware } from '../middleware/auth'
import { requirePermissionMiddleware } from '../middleware/permissions'
import { onValidationError } from '../middleware/validation'
import { sendCreated, sendResult } from '../util/result_response'

/** Loads a shelf the requester may access (via its rack): the row, or the 404/403 response. */
async function loadShelf(c: Context, id: number): Promise<ShelfRow | Response> {
	const shelf = await getShelf(id)
	if (Result.isError(shelf)) {
		return sendResult(c, shelf)
	}
	return checkTenant(c, (await shelfTenant(id)) ?? null) ?? shelf.value
}

/**
 * Shelves are tenant-bearing via their rack (no `tenant_id` column of their
 * own): scoped callers may only mount shelves on racks inside their scope,
 * and every row answer inherits the rack's tenant for read/write gates.
 */
export const shelvesApp = new Hono()
	.use(authMiddleware)
	.use(requirePermissionMiddleware('view'))
	.get('/', vValidator('query', ShelfListQuerySchema, onValidationError), async (c) => {
		const query = c.req.valid('query')
		// Shelves have no `?tenant=` param of their own; the scope still
		// applies through the rack.
		const scope = await listTenantScope(c, undefined)
		if (scope instanceof Response) {
			return scope
		}
		return c.json(
			await listShelves({
				search: query.search,
				page: query.page,
				limit: query.limit,
				rack: query.rack,
				sort: query.sort,
				order: query.order,
				...scope,
			}),
		)
	})
	.post(
		'/',
		requirePermissionMiddleware('edit'),
		vValidator('json', ShelfCreateSchema, onValidationError),
		async (c) => {
			const body = c.req.valid('json')
			// A missing rack answers 404 from the service; an out-of-scope rack
			// answers 403 here before anything is written.
			return (
				checkTenant(c, await rackTenant(body.rack_id)) ??
				sendCreated(c, await createShelf(body))
			)
		},
	)
	.get('/:id', vValidator('param', EntityParamsSchema, onValidationError), async (c) => {
		const shelf = await loadShelf(c, c.req.valid('param').id)
		if (shelf instanceof Response) {
			return shelf
		}
		return c.json(shelf)
	})
	.patch(
		'/:id',
		requirePermissionMiddleware('edit'),
		vValidator('param', EntityParamsSchema, onValidationError),
		vValidator('json', ShelfUpdateSchema, onValidationError),
		async (c) => {
			const id = c.req.valid('param').id
			const body = c.req.valid('json')
			const shelf = await loadShelf(c, id)
			if (shelf instanceof Response) {
				return shelf
			}
			// Moving to another rack must not smuggle the shelf out of scope.
			if (body.rack_id !== undefined && body.rack_id !== shelf.rack_id) {
				const denied = checkTenant(c, await rackTenant(body.rack_id))
				if (denied) {
					return denied
				}
			}
			return sendResult(c, await updateShelf(id, body))
		},
	)
	.delete(
		'/:id',
		requirePermissionMiddleware('delete'),
		vValidator('param', EntityParamsSchema, onValidationError),
		async (c) => {
			const id = c.req.valid('param').id
			const shelf = await loadShelf(c, id)
			if (shelf instanceof Response) {
				return shelf
			}
			return sendResult(c, await deleteShelf(id))
		},
	)
