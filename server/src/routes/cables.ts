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
	requireWrite,
	scopeTenantId,
} from '../authz'
import { connectCable, deleteCable, getCable, listCables, updateCable } from '../db/cables'
import { exportCablesCsv, importCablesCsv } from '../db/csv_transfer'
import { ForbiddenError } from '../db/errors'
import { getCableTrace } from '../db/topology'
import { authMiddleware } from '../middleware/auth'
import { onValidationError } from '../middleware/validation'
import { sendResult } from '../util/result_response'

/**
 * Cables carry no tenant of their own: every gate follows both endpoint
 * devices (see `authz.ts` `canReadCable`/`canWriteCable`). Listing is
 * scope-filtered in SQL; single-object routes resolve the endpoints
 * (`undefined` = gone, fall through to the service 404).
 */
export const cablesApp = new Hono()
	.use(authMiddleware)
	.get('/', vValidator('query', CableListQuerySchema, onValidationError), (c) => {
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
		if (query.interface !== undefined) {
			const tenant = interfaceTenant(query.interface)
			if (tenant !== undefined) {
				const denied = checkRead(c, tenant)
				if (denied) {
					return denied
				}
			}
		}
		const scope = scopeTenantId(requestUser(c))
		return c.json(
			listCables({
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
	.post('/', vValidator('json', CableCreateSchema, onValidationError), (c) => {
		const denied = requireWrite(c)
		if (denied) {
			return denied
		}
		const body = c.req.valid('json')
		const tenantA = interfaceTenant(body.a_interface_id)
		const tenantB = interfaceTenant(body.b_interface_id)
		if (tenantA !== undefined && tenantB !== undefined) {
			if (!canWriteCable(requestUser(c), [tenantA, tenantB])) {
				return sendResult(
					c,
					Result.err(new ForbiddenError('Cable endpoints are outside your tenant scope')),
				)
			}
		}
		const result = connectCable(body)
		if (Result.isOk(result)) {
			return c.json(result.value, 201)
		}
		return sendResult(c, result)
	})
	// CSV transfer (registered before `/:id` so the literal paths win).
	.get('/export', (c) => {
		const scope = scopeTenantId(requestUser(c))
		return c.text(exportCablesCsv(scope ?? undefined), 200, {
			'Content-Type': 'text/csv; charset=utf-8',
			'Content-Disposition': 'attachment; filename="cables.csv"',
		})
	})
	.post('/import', vValidator('json', CsvImportBodySchema, onValidationError), (c) => {
		const denied = requireWrite(c)
		if (denied) {
			return denied
		}
		const scope = scopeTenantId(requestUser(c))
		const result = importCablesCsv(c.req.valid('json').csv, scope ?? undefined)
		if (Result.isOk(result)) {
			return c.json(result.value, 201)
		}
		return sendResult(c, result)
	})
	.get(
		'/:id/trace',
		vValidator('param', EntityParamsSchema, onValidationError),
		vValidator('query', TraceQuerySchema, onValidationError),
		(c) => {
			const id = c.req.valid('param').id
			const depth = c.req.valid('query').depth
			const result = getCable(id)
			if (Result.isError(result)) {
				return sendResult(c, result)
			}
			if (!canReadCable(requestUser(c), cableTenants(result.value))) {
				return sendResult(
					c,
					Result.err(new ForbiddenError('Cable endpoints are outside your tenant scope')),
				)
			}
			const scope = scopeTenantId(requestUser(c))
			return sendResult(c, getCableTrace(id, depth, scope ?? undefined))
		},
	)
	.get('/:id', vValidator('param', EntityParamsSchema, onValidationError), (c) => {
		const result = getCable(c.req.valid('param').id)
		if (Result.isError(result)) {
			return sendResult(c, result)
		}
		if (!canReadCable(requestUser(c), cableTenants(result.value))) {
			return sendResult(
				c,
				Result.err(new ForbiddenError('Cable endpoints are outside your tenant scope')),
			)
		}
		return c.json(result.value)
	})
	.patch(
		'/:id',
		vValidator('param', EntityParamsSchema, onValidationError),
		vValidator('json', CableUpdateSchema, onValidationError),
		(c) => {
			const denied = requireWrite(c)
			if (denied) {
				return denied
			}
			const id = c.req.valid('param').id
			const current = getCable(id)
			if (Result.isError(current)) {
				return sendResult(c, current)
			}
			if (!canWriteCable(requestUser(c), cableTenants(current.value))) {
				return sendResult(
					c,
					Result.err(new ForbiddenError('Cable endpoints are outside your tenant scope')),
				)
			}
			const result = updateCable(id, c.req.valid('json'))
			if (Result.isOk(result)) {
				return c.json(result.value)
			}
			return sendResult(c, result)
		},
	)
	.delete('/:id', vValidator('param', EntityParamsSchema, onValidationError), (c) => {
		const denied = requireWrite(c)
		if (denied) {
			return denied
		}
		const id = c.req.valid('param').id
		const current = getCable(id)
		if (Result.isError(current)) {
			return sendResult(c, current)
		}
		if (!canWriteCable(requestUser(c), cableTenants(current.value))) {
			return sendResult(
				c,
				Result.err(new ForbiddenError('Cable endpoints are outside your tenant scope')),
			)
		}
		const result = deleteCable(id)
		if (Result.isOk(result)) {
			return c.json(result.value)
		}
		return sendResult(c, result)
	})
