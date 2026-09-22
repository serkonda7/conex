import { vValidator } from '@hono/valibot-validator'
import { Result } from 'better-result'
import { Hono } from 'hono'
import {
	CsvImportBodySchema,
	DeviceCreateSchema,
	DeviceListQuerySchema,
	DeviceMoveSchema,
	DeviceUpdateSchema,
	EntityParamsSchema,
	IdSchema,
	InterfaceConnectSchema,
	InterfaceCreateSchema,
	InterfaceUpdateSchema,
	TraceQuerySchema,
} from 'shared/src/schemas'
import * as v from 'valibot'
import {
	canWriteCable,
	checkRead,
	checkWrite,
	deviceTenant,
	guardUpdate,
	guardWrite,
	interfaceTenant,
	listTenantScope,
	requestUser,
	requireWrite,
	resolveCreateTenant,
	scopeTenantId,
	sendTenantRow,
} from '../authz'
import { connectCable, getDeviceTrace } from '../db/cables'
import { exportDevicesCsv, importDevicesCsv } from '../db/csv_transfer'
import {
	addInterface,
	createDevice,
	deleteDevice,
	getDevice,
	getInterface,
	listDevices,
	listInterfaces,
	moveDevice,
	updateDevice,
	updateInterface,
} from '../db/devices'
import { ForbiddenError } from '../db/errors'
import { getInterfaceTrace } from '../db/topology'
import { authMiddleware } from '../middleware/auth'
import { onValidationError } from '../middleware/validation'
import { sendResult } from '../util/result_response'

const deviceIfaceParamsSchema = v.object({ id: IdSchema, ifaceId: IdSchema })

/**
 * Devices are tenant-bearing; interfaces inherit their device's tenant.
 * CSV export is a filtered read, CSV import a scoped write (rows outside
 * the scope fail per-row in `db/csv_transfer.ts`).
 */
export const devicesApp = new Hono()
	.use(authMiddleware)
	.get('/', vValidator('query', DeviceListQuerySchema, onValidationError), (c) => {
		const query = c.req.valid('query')
		const scope = listTenantScope(c, query.tenant)
		if (scope instanceof Response) {
			return scope
		}
		return c.json(
			listDevices({
				search: query.search,
				page: query.page,
				limit: query.limit,
				site: query.site,
				rack: query.rack,
				status: query.status,
				sort: query.sort,
				order: query.order,
				...scope,
			}),
		)
	})
	.post('/', vValidator('json', DeviceCreateSchema, onValidationError), (c) => {
		const denied = requireWrite(c)
		if (denied) {
			return denied
		}
		const body = c.req.valid('json')
		const tenant = resolveCreateTenant(c, body.tenant_id)
		if (tenant instanceof Response) {
			return tenant
		}
		const result = createDevice({ ...body, tenant_id: tenant })
		if (Result.isOk(result)) {
			return c.json(result.value, 201)
		}
		return sendResult(c, result)
	})
	// CSV transfer (registered before `/:id` so the literal paths win).
	.get('/export', (c) => {
		const scope = scopeTenantId(requestUser(c))
		return c.text(exportDevicesCsv(scope ?? undefined), 200, {
			'Content-Type': 'text/csv; charset=utf-8',
			'Content-Disposition': 'attachment; filename="devices.csv"',
		})
	})
	.post('/import', vValidator('json', CsvImportBodySchema, onValidationError), (c) => {
		const denied = requireWrite(c)
		if (denied) {
			return denied
		}
		const scope = scopeTenantId(requestUser(c))
		const result = importDevicesCsv(c.req.valid('json').csv, scope ?? undefined)
		if (Result.isOk(result)) {
			return c.json(result.value, 201)
		}
		return sendResult(c, result)
	})
	.get('/:id', vValidator('param', EntityParamsSchema, onValidationError), (c) => {
		return sendTenantRow(c, getDevice(c.req.valid('param').id))
	})
	.patch(
		'/:id',
		vValidator('param', EntityParamsSchema, onValidationError),
		vValidator('json', DeviceUpdateSchema, onValidationError),
		(c) => {
			const id = c.req.valid('param').id
			const body = c.req.valid('json')
			const current = getDevice(id)
			if (Result.isError(current)) {
				return sendResult(c, current)
			}
			const denied = guardUpdate(c, current.value.tenant_id, body.tenant_id)
			if (denied) {
				return denied
			}
			const result = updateDevice(id, body)
			if (Result.isOk(result)) {
				return c.json(result.value)
			}
			return sendResult(c, result)
		},
	)
	.delete('/:id', vValidator('param', EntityParamsSchema, onValidationError), (c) => {
		const id = c.req.valid('param').id
		const current = getDevice(id)
		if (Result.isError(current)) {
			return sendResult(c, current)
		}
		const denied = guardWrite(c, current.value.tenant_id)
		if (denied) {
			return denied
		}
		const result = deleteDevice(id)
		if (Result.isOk(result)) {
			return c.json(result.value)
		}
		return sendResult(c, result)
	})
	// Explicit remount: re-validates U/shelf exactly like creation.
	.post(
		'/:id/move',
		vValidator('param', EntityParamsSchema, onValidationError),
		vValidator('json', DeviceMoveSchema, onValidationError),
		(c) => {
			const id = c.req.valid('param').id
			const current = getDevice(id)
			if (Result.isError(current)) {
				return sendResult(c, current)
			}
			const denied = guardWrite(c, current.value.tenant_id)
			if (denied) {
				return denied
			}
			const result = moveDevice(id, c.req.valid('json'))
			if (Result.isOk(result)) {
				return c.json(result.value)
			}
			return sendResult(c, result)
		},
	)
	// Interface sub-resource (name unique per device; `connected` is P5-owned).
	.get('/:id/interfaces', vValidator('param', EntityParamsSchema, onValidationError), (c) => {
		const id = c.req.valid('param').id
		const tenant = deviceTenant(id)
		if (tenant === undefined) {
			return sendResult(c, listInterfaces(id))
		}
		const denied = checkRead(c, tenant)
		if (denied) {
			return denied
		}
		return sendResult(c, listInterfaces(id))
	})
	.post(
		'/:id/interfaces',
		vValidator('param', EntityParamsSchema, onValidationError),
		vValidator('json', InterfaceCreateSchema, onValidationError),
		(c) => {
			const denied = requireWrite(c)
			if (denied) {
				return denied
			}
			const id = c.req.valid('param').id
			const tenant = deviceTenant(id)
			if (tenant !== undefined) {
				const scopeDenied = checkWrite(c, tenant)
				if (scopeDenied) {
					return scopeDenied
				}
			}
			const result = addInterface(id, c.req.valid('json'))
			if (Result.isOk(result)) {
				return c.json(result.value, 201)
			}
			return sendResult(c, result)
		},
	)
	.get(
		'/:id/interfaces/:ifaceId',
		vValidator('param', deviceIfaceParamsSchema, onValidationError),
		(c) => {
			const param = c.req.valid('param')
			const local = getInterface(param.id, param.ifaceId)
			if (Result.isError(local)) {
				return sendResult(c, local)
			}
			const tenant = deviceTenant(param.id)
			if (tenant !== undefined) {
				const denied = checkRead(c, tenant)
				if (denied) {
					return denied
				}
			}
			return c.json(local.value)
		},
	)
	.patch(
		'/:id/interfaces/:ifaceId',
		vValidator('param', deviceIfaceParamsSchema, onValidationError),
		vValidator('json', InterfaceUpdateSchema, onValidationError),
		(c) => {
			const denied = requireWrite(c)
			if (denied) {
				return denied
			}
			const param = c.req.valid('param')
			const tenant = deviceTenant(param.id)
			if (tenant !== undefined) {
				const scopeDenied = checkWrite(c, tenant)
				if (scopeDenied) {
					return scopeDenied
				}
			}
			const result = updateInterface(param.id, param.ifaceId, c.req.valid('json'))
			if (Result.isOk(result)) {
				return c.json(result.value)
			}
			return sendResult(c, result)
		},
	)
	// Convenience connect: one end in the path, the peer in the body.
	.post(
		'/:id/interfaces/:ifaceId/connect',
		vValidator('param', deviceIfaceParamsSchema, onValidationError),
		vValidator('json', InterfaceConnectSchema, onValidationError),
		(c) => {
			const denied = requireWrite(c)
			if (denied) {
				return denied
			}
			const param = c.req.valid('param')
			const local = getInterface(param.id, param.ifaceId)
			if (Result.isError(local)) {
				return sendResult(c, local)
			}
			const peerTenant = interfaceTenant(c.req.valid('json').peer_interface_id)
			if (peerTenant === undefined) {
				// Unknown peer: let the service answer 404.
				const result = connectCable({
					a_interface_id: param.ifaceId,
					b_interface_id: c.req.valid('json').peer_interface_id,
					status: 'connected',
				})
				if (Result.isOk(result)) {
					return c.json(result.value, 201)
				}
				return sendResult(c, result)
			}
			const localTenant = deviceTenant(param.id)
			if (
				localTenant !== undefined &&
				!canWriteCable(requestUser(c), [localTenant, peerTenant])
			) {
				return sendResult(
					c,
					Result.err(new ForbiddenError('Cable endpoints are outside your tenant scope')),
				)
			}
			const result = connectCable({
				a_interface_id: param.ifaceId,
				b_interface_id: c.req.valid('json').peer_interface_id,
				status: 'connected',
			})
			if (Result.isOk(result)) {
				return c.json(result.value, 201)
			}
			return sendResult(c, result)
		},
	)
	// Per-device L1 trace: direct peer links plus depth-limited multi-hop
	// shortest paths (`?depth=1..10`, default 4). Scoped callers traverse
	// only cables with both ends in their tenant.
	.get(
		'/:id/trace',
		vValidator('param', EntityParamsSchema, onValidationError),
		vValidator('query', TraceQuerySchema, onValidationError),
		(c) => {
			const id = c.req.valid('param').id
			const depth = c.req.valid('query').depth
			const tenant = deviceTenant(id)
			const scope = scopeTenantId(requestUser(c))
			if (tenant === undefined) {
				return sendResult(c, getDeviceTrace(id, depth, scope ?? undefined))
			}
			const denied = checkRead(c, tenant)
			if (denied) {
				return denied
			}
			return sendResult(c, getDeviceTrace(id, depth, scope ?? undefined))
		},
	)
	// Per-interface cable trace: all shortest paths starting at one port.
	.get(
		'/:id/interfaces/:ifaceId/trace',
		vValidator('param', deviceIfaceParamsSchema, onValidationError),
		vValidator('query', TraceQuerySchema, onValidationError),
		(c) => {
			const param = c.req.valid('param')
			const depth = c.req.valid('query').depth
			const tenant = deviceTenant(param.id)
			const scope = scopeTenantId(requestUser(c))
			if (tenant === undefined) {
				return sendResult(
					c,
					getInterfaceTrace(param.id, param.ifaceId, depth, scope ?? undefined),
				)
			}
			const denied = checkRead(c, tenant)
			if (denied) {
				return denied
			}
			return sendResult(
				c,
				getInterfaceTrace(param.id, param.ifaceId, depth, scope ?? undefined),
			)
		},
	)
