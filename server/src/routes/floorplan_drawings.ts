import { vValidator } from '@hono/valibot-validator'
import { type Context, Hono } from 'hono'
import {
	EntityParamsSchema,
	FloorplanDrawingCreateSchema,
	FloorplanDrawingListQuerySchema,
	FloorplanDrawingOwnerQuerySchema,
	FloorplanDrawingPutSchema,
} from 'shared/src/schemas'
import { checkTenant, listTenantScope, loadScoped, requestScope } from '../authz'
import {
	createDrawing,
	deleteDrawing,
	getDrawing,
	getDrawingRef,
	getDrawingWithTenant,
	listDrawingCandidates,
	listDrawings,
	putDrawing,
} from '../db/floorplan_drawings'
import { ownerTenant } from '../db/owners'
import { authMiddleware } from '../middleware/auth'
import { requirePermissionMiddleware } from '../middleware/permissions'
import { onValidationError } from '../middleware/validation'
import { sendCreated, sendResult } from '../util/result_response'
import { listQueryParams } from './crud'

/** Gates a drawn plan by its owner's tenant: `null` when the requester may access it. */
async function gateDrawing(c: Context, id: number): Promise<Response | null> {
	const loaded = await loadScoped(c, await getDrawingWithTenant(id), (found) =>
		checkTenant(c, found.tenant),
	)
	return loaded instanceof Response ? loaded : null
}

/**
 * Drawn floor plans (v2) of sites and locations. Tenant scope comes from the
 * owning site or location; markers are further filtered to the requester's
 * scope by the service.
 */
export const floorplanDrawingsApp = new Hono()
	.use(authMiddleware)
	.use(requirePermissionMiddleware('view'))
	.get(
		'/',
		vValidator('query', FloorplanDrawingListQuerySchema, onValidationError),
		async (c) => {
			const query = c.req.valid('query')
			const scope = await listTenantScope(c, query.tenant, query.tenant_group)
			if (scope instanceof Response) {
				return scope
			}
			return c.json(await listDrawings({ ...listQueryParams(query), ...scope }))
		},
	)
	.get(
		'/owner',
		vValidator('query', FloorplanDrawingOwnerQuerySchema, onValidationError),
		async (c) => {
			const query = c.req.valid('query')
			const owner =
				query.site !== undefined ? { site_id: query.site } : { location_id: query.location }
			return (
				checkTenant(c, await ownerTenant(owner)) ??
				sendResult(c, await getDrawingRef(owner))
			)
		},
	)
	.post(
		'/',
		requirePermissionMiddleware('edit'),
		vValidator('json', FloorplanDrawingCreateSchema, onValidationError),
		async (c) => {
			const body = c.req.valid('json')
			return (
				checkTenant(
					c,
					await ownerTenant({ site_id: body.site_id, location_id: body.location_id }),
				) ?? sendCreated(c, await createDrawing(body))
			)
		},
	)
	.get('/:id', vValidator('param', EntityParamsSchema, onValidationError), async (c) => {
		const id = c.req.valid('param').id
		return (await gateDrawing(c, id)) ?? sendResult(c, await getDrawing(id, requestScope(c)))
	})
	.put(
		'/:id',
		requirePermissionMiddleware('edit'),
		vValidator('param', EntityParamsSchema, onValidationError),
		vValidator('json', FloorplanDrawingPutSchema, onValidationError),
		async (c) => {
			const id = c.req.valid('param').id
			return (
				(await gateDrawing(c, id)) ??
				sendResult(c, await putDrawing(id, c.req.valid('json'), requestScope(c)))
			)
		},
	)
	.get(
		'/:id/candidates',
		requirePermissionMiddleware('edit'),
		vValidator('param', EntityParamsSchema, onValidationError),
		async (c) => {
			const id = c.req.valid('param').id
			return (
				(await gateDrawing(c, id)) ??
				sendResult(c, await listDrawingCandidates(id, requestScope(c)))
			)
		},
	)
	.delete(
		'/:id',
		requirePermissionMiddleware('delete'),
		vValidator('param', EntityParamsSchema, onValidationError),
		async (c) => {
			const id = c.req.valid('param').id
			return (await gateDrawing(c, id)) ?? sendResult(c, await deleteDrawing(id))
		},
	)
