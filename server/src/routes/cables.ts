import { vValidator } from '@hono/valibot-validator'
import { Result } from 'better-result'
import { Hono } from 'hono'
import {
	CableCreateSchema,
	CableListQuerySchema,
	CableUpdateSchema,
	CsvImportBodySchema,
	EntityParamsSchema,
	TraceQuerySchema,
} from 'shared/src/schemas'
import {
	cableTenants,
	canReadCable,
	canWriteCable,
	checkRead,
	deviceTenant,
	interfaceTenant,
	requestUser,
	scopeTenantId,
} from '../authz'
import { connectCable, deleteCable, getCable, listCables, updateCable } from '../db/cables'
import { exportCablesCsv, importCablesCsv } from '../db/csv_transfer'
import { getCableTrace } from '../db/topology'
import { authMiddleware } from '../middleware/auth'
import { requireWriteMiddleware } from '../middleware/roles'
import { onValidationError } from '../middleware/validation'
import { sendResult } from '../util/result_response'
import { cableScopeDenied, sendCreated, sendCsv, sendRow } from './helpers'

/**
 * Cables carry no tenant of their own: every gate follows both endpoint
 * devices (see `authz.ts` `canReadCable`/`canWriteCable`). Listing is
 * scope-filtered in SQL; single-object routes resolve the endpoints
 * (`undefined` = gone, fall through to the service 404).
 */
export const cablesApp = new Hono()
	.use(authMiddleware)
	.get('/', vValidator('query', CableListQuerySchema, onValidationError), async (c) => {
		const query = c.req.valid('query')
		if (query.device !== undefined) {
			const tenant = await deviceTenant(query.device)
			if (tenant !== undefined) {
				const denied = checkRead(c, tenant)
				if (denied) {
					return denied
				}
			}
		}
		if (query.interface !== undefined) {
			const tenant = await interfaceTenant(query.interface)
			if (tenant !== undefined) {
				const denied = checkRead(c, tenant)
				if (denied) {
					return denied
				}
			}
		}
		const scope = scopeTenantId(requestUser(c))
		return c.json(
			await listCables({
				search: query.search,
				page: query.page,
				limit: query.limit,
				status: query.status,
				interface: query.interface,
				device: query.device,
				...(scope !== null ? { scopeTenantId: scope } : {}),
			}),
		)
	})
	.post(
		'/',
		requireWriteMiddleware,
		vValidator('json', CableCreateSchema, onValidationError),
		async (c) => {
			const body = c.req.valid('json')
			const tenantA = await interfaceTenant(body.a_interface_id)
			const tenantB = await interfaceTenant(body.b_interface_id)
			if (tenantA !== undefined && tenantB !== undefined) {
				if (!canWriteCable(requestUser(c), [tenantA, tenantB])) {
					return sendResult(c, cableScopeDenied())
				}
			}
			return sendCreated(c, await connectCable(body))
		},
	)
	// CSV transfer (registered before `/:id` so the literal paths win).
	.get('/export', async (c) => {
		const scope = scopeTenantId(requestUser(c))
		return sendCsv(c, await exportCablesCsv(scope ?? undefined), 'cables.csv')
	})
	.post(
		'/import',
		requireWriteMiddleware,
		vValidator('json', CsvImportBodySchema, onValidationError),
		async (c) => {
			const scope = scopeTenantId(requestUser(c))
			return sendCreated(
				c,
				await importCablesCsv(c.req.valid('json').csv, scope ?? undefined),
			)
		},
	)
	.get(
		'/:id/trace',
		vValidator('param', EntityParamsSchema, onValidationError),
		vValidator('query', TraceQuerySchema, onValidationError),
		async (c) => {
			const id = c.req.valid('param').id
			const depth = c.req.valid('query').depth
			const result = await getCable(id)
			if (Result.isError(result)) {
				return sendResult(c, result)
			}
			if (!canReadCable(requestUser(c), await cableTenants(result.value))) {
				return sendResult(c, cableScopeDenied())
			}
			const scope = scopeTenantId(requestUser(c))
			return sendResult(c, await getCableTrace(id, depth, scope ?? undefined))
		},
	)
	.get('/:id', vValidator('param', EntityParamsSchema, onValidationError), async (c) => {
		const result = await getCable(c.req.valid('param').id)
		if (Result.isError(result)) {
			return sendResult(c, result)
		}
		if (!canReadCable(requestUser(c), await cableTenants(result.value))) {
			return sendResult(c, cableScopeDenied())
		}
		return c.json(result.value)
	})
	.patch(
		'/:id',
		requireWriteMiddleware,
		vValidator('param', EntityParamsSchema, onValidationError),
		vValidator('json', CableUpdateSchema, onValidationError),
		async (c) => {
			const id = c.req.valid('param').id
			const current = await getCable(id)
			if (Result.isError(current)) {
				return sendResult(c, current)
			}
			if (!canWriteCable(requestUser(c), await cableTenants(current.value))) {
				return sendResult(c, cableScopeDenied())
			}
			return sendRow(c, await updateCable(id, c.req.valid('json')))
		},
	)
	.delete(
		'/:id',
		requireWriteMiddleware,
		vValidator('param', EntityParamsSchema, onValidationError),
		async (c) => {
			const id = c.req.valid('param').id
			const current = await getCable(id)
			if (Result.isError(current)) {
				return sendResult(c, current)
			}
			if (!canWriteCable(requestUser(c), await cableTenants(current.value))) {
				return sendResult(c, cableScopeDenied())
			}
			return sendRow(c, await deleteCable(id))
		},
	)
