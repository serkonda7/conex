import { vValidator } from '@hono/valibot-validator'
import { Result } from 'better-result'
import { type Context, Hono } from 'hono'
import {
	CableCreateSchema,
	CableListQuerySchema,
	CableUpdateSchema,
	CsvImportBodySchema,
	EntityParamsSchema,
	TraceQuerySchema,
} from 'shared/src/schemas'
import { checkCable, checkTenant, requestScope } from '../authz'
import {
	type CableRow,
	connectCable,
	deleteCable,
	getCable,
	listCables,
	updateCable,
} from '../db/cables'
import { exportCablesCsv, importCablesCsv } from '../db/csv_transfer'
import { cableTenants, deviceTenant, interfaceTenant } from '../db/owners'
import { getCableTrace } from '../db/trace'
import { authMiddleware } from '../middleware/auth'
import { requirePermissionMiddleware } from '../middleware/permissions'
import { onValidationError } from '../middleware/validation'
import { sendCsv } from '../util/http'
import { sendCreated, sendResult } from '../util/result_response'

/** Loads a cable the requester may access: the row, or the 404/403 response. */
async function loadCable(c: Context, id: number): Promise<CableRow | Response> {
	const cable = await getCable(id)
	if (Result.isError(cable)) {
		return sendResult(c, cable)
	}
	return checkCable(c, await cableTenants(cable.value)) ?? cable.value
}

/**
 * Cables carry no tenant of their own: every gate follows both endpoint
 * devices (see `authz.ts` `canAccessCable`). Listing is scope-filtered in
 * SQL; single-object routes resolve the endpoints (`undefined` = gone, fall
 * through to the service 404).
 */
export const cablesApp = new Hono()
	.use(authMiddleware)
	.use(requirePermissionMiddleware('view'))
	.get('/', vValidator('query', CableListQuerySchema, onValidationError), async (c) => {
		const query = c.req.valid('query')
		const denied =
			(query.device !== undefined
				? checkTenant(c, await deviceTenant(query.device))
				: null) ??
			(query.interface !== undefined
				? checkTenant(c, await interfaceTenant(query.interface))
				: null)
		if (denied) {
			return denied
		}
		return c.json(
			await listCables({
				search: query.search,
				page: query.page,
				limit: query.limit,
				status: query.status,
				interface: query.interface,
				device: query.device,
				scopeTenantId: requestScope(c),
			}),
		)
	})
	.post(
		'/',
		requirePermissionMiddleware('edit'),
		vValidator('json', CableCreateSchema, onValidationError),
		async (c) => {
			const body = c.req.valid('json')
			const tenantA = await interfaceTenant(body.a_interface_id)
			const tenantB = await interfaceTenant(body.b_interface_id)
			if (tenantA !== undefined && tenantB !== undefined) {
				const denied = checkCable(c, [tenantA, tenantB])
				if (denied) {
					return denied
				}
			}
			return sendCreated(c, await connectCable(body))
		},
	)
	// CSV transfer (registered before `/:id` so the literal paths win).
	.get('/export', async (c) => {
		return sendCsv(c, await exportCablesCsv(requestScope(c)), 'cables.csv')
	})
	.post(
		'/import',
		requirePermissionMiddleware('edit'),
		vValidator('json', CsvImportBodySchema, onValidationError),
		async (c) => {
			return sendCreated(c, await importCablesCsv(c.req.valid('json').csv, requestScope(c)))
		},
	)
	.get(
		'/:id/trace',
		vValidator('param', EntityParamsSchema, onValidationError),
		vValidator('query', TraceQuerySchema, onValidationError),
		async (c) => {
			const id = c.req.valid('param').id
			const cable = await loadCable(c, id)
			if (cable instanceof Response) {
				return cable
			}
			return sendResult(
				c,
				await getCableTrace(id, c.req.valid('query').depth, requestScope(c)),
			)
		},
	)
	.get('/:id', vValidator('param', EntityParamsSchema, onValidationError), async (c) => {
		const cable = await loadCable(c, c.req.valid('param').id)
		if (cable instanceof Response) {
			return cable
		}
		return c.json(cable)
	})
	.patch(
		'/:id',
		requirePermissionMiddleware('edit'),
		vValidator('param', EntityParamsSchema, onValidationError),
		vValidator('json', CableUpdateSchema, onValidationError),
		async (c) => {
			const id = c.req.valid('param').id
			const cable = await loadCable(c, id)
			if (cable instanceof Response) {
				return cable
			}
			return sendResult(c, await updateCable(id, c.req.valid('json')))
		},
	)
	.delete(
		'/:id',
		requirePermissionMiddleware('delete'),
		vValidator('param', EntityParamsSchema, onValidationError),
		async (c) => {
			const id = c.req.valid('param').id
			const cable = await loadCable(c, id)
			if (cable instanceof Response) {
				return cable
			}
			return sendResult(c, await deleteCable(id))
		},
	)
