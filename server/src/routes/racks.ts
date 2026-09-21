import { vValidator } from '@hono/valibot-validator'
import { Result } from 'better-result'
import { Hono } from 'hono'
import {
	EntityParamsSchema,
	RackCreateSchema,
	RackListQuerySchema,
	RackUpdateSchema,
} from 'shared/src/schemas'
import {
	checkRead,
	guardUpdate,
	guardWrite,
	listTenantScope,
	requireWrite,
	resolveCreateTenant,
	sendTenantRow,
} from '../authz'
import { createRack, deleteRack, getElevation, getRack, listRacks, updateRack } from '../db/racks'
import { authMiddleware } from '../middleware/auth'
import { onValidationError } from '../middleware/validation'
import { sendResult } from '../util/result_response'

export const racksApp = new Hono()
	.use(authMiddleware)
	.get('/', vValidator('query', RackListQuerySchema, onValidationError), (c) => {
		const query = c.req.valid('query')
		const scope = listTenantScope(c, query.tenant)
		if (scope instanceof Response) {
			return scope
		}
		return c.json(
			listRacks({
				search: query.search,
				page: query.page,
				limit: query.limit,
				site: query.site,
				location: query.location,
				sort: query.sort,
				order: query.order,
				...scope,
			}),
		)
	})
	.post('/', vValidator('json', RackCreateSchema, onValidationError), (c) => {
		const denied = requireWrite(c)
		if (denied) {
			return denied
		}
		const body = c.req.valid('json')
		const tenant = resolveCreateTenant(c, body.tenant_id)
		if (tenant instanceof Response) {
			return tenant
		}
		const result = createRack({ ...body, tenant_id: tenant })
		if (Result.isOk(result)) {
			return c.json(result.value, 201)
		}
		return sendResult(c, result)
	})
	.get('/:id/elevation', vValidator('param', EntityParamsSchema, onValidationError), (c) => {
		const rack = getRack(c.req.valid('param').id)
		if (Result.isError(rack)) {
			return sendResult(c, rack)
		}
		const denied = checkRead(c, rack.value.tenant_id)
		if (denied) {
			return denied
		}
		return sendResult(c, getElevation(c.req.valid('param').id))
	})
	.get('/:id', vValidator('param', EntityParamsSchema, onValidationError), (c) => {
		return sendTenantRow(c, getRack(c.req.valid('param').id))
	})
	.patch(
		'/:id',
		vValidator('param', EntityParamsSchema, onValidationError),
		vValidator('json', RackUpdateSchema, onValidationError),
		(c) => {
			const id = c.req.valid('param').id
			const body = c.req.valid('json')
			const current = getRack(id)
			if (Result.isError(current)) {
				return sendResult(c, current)
			}
			const denied = guardUpdate(c, current.value.tenant_id, body.tenant_id)
			if (denied) {
				return denied
			}
			const result = updateRack(id, body)
			if (Result.isOk(result)) {
				return c.json(result.value)
			}
			return sendResult(c, result)
		},
	)
	.delete('/:id', vValidator('param', EntityParamsSchema, onValidationError), (c) => {
		const id = c.req.valid('param').id
		const current = getRack(id)
		if (Result.isError(current)) {
			return sendResult(c, current)
		}
		const denied = guardWrite(c, current.value.tenant_id)
		if (denied) {
			return denied
		}
		const result = deleteRack(id)
		if (Result.isOk(result)) {
			return c.json(result.value)
		}
		return sendResult(c, result)
	})
