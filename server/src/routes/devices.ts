import { vValidator } from '@hono/valibot-validator'
import { Result } from 'better-result'
import { Hono } from 'hono'
import {
	CsvImportBodySchema,
	DeviceCreateSchema,
	DeviceIfaceParamsSchema,
	DeviceListQuerySchema,
	DeviceMoveSchema,
	DeviceUpdateSchema,
	EntityParamsSchema,
	InterfaceConnectSchema,
	InterfaceCreateSchema,
	InterfaceUpdateSchema,
	TraceQuerySchema,
} from 'shared/src/schemas'
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
import { getInterfaceTrace } from '../db/topology'
import { authMiddleware } from '../middleware/auth'
import { requireWriteMiddleware } from '../middleware/roles'
import { onValidationError } from '../middleware/validation'
import { sendResult } from '../util/result_response'
import { cableScopeDenied, sendCreated, sendCsv, sendRow } from './helpers'

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
	.post(
		'/',
		requireWriteMiddleware,
		vValidator('json', DeviceCreateSchema, onValidationError),
		(c) => {
			const body = c.req.valid('json')
			const tenant = resolveCreateTenant(c, body.tenant_id)
			if (tenant instanceof Response) {
				return tenant
			}
			return sendCreated(c, createDevice({ ...body, tenant_id: tenant }))
		},
	)
	// CSV transfer (registered before `/:id` so the literal paths win).
	.get('/export', (c) => {
		const scope = scopeTenantId(requestUser(c))
		return sendCsv(c, exportDevicesCsv(scope ?? undefined), 'devices.csv')
	})
	.post(
		'/import',
		requireWriteMiddleware,
		vValidator('json', CsvImportBodySchema, onValidationError),
		(c) => {
			const scope = scopeTenantId(requestUser(c))
			return sendCreated(c, importDevicesCsv(c.req.valid('json').csv, scope ?? undefined))
		},
	)
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
			return sendRow(c, updateDevice(id, body))
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
		return sendRow(c, deleteDevice(id))
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
			return sendRow(c, moveDevice(id, c.req.valid('json')))
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
		requireWriteMiddleware,
		vValidator('param', EntityParamsSchema, onValidationError),
		vValidator('json', InterfaceCreateSchema, onValidationError),
		(c) => {
			const id = c.req.valid('param').id
			const tenant = deviceTenant(id)
			if (tenant !== undefined) {
				const scopeDenied = checkWrite(c, tenant)
				if (scopeDenied) {
					return scopeDenied
				}
			}
			return sendCreated(c, addInterface(id, c.req.valid('json')))
		},
	)
	.get(
		'/:id/interfaces/:ifaceId',
		vValidator('param', DeviceIfaceParamsSchema, onValidationError),
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
		requireWriteMiddleware,
		vValidator('param', DeviceIfaceParamsSchema, onValidationError),
		vValidator('json', InterfaceUpdateSchema, onValidationError),
		(c) => {
			const param = c.req.valid('param')
			const tenant = deviceTenant(param.id)
			if (tenant !== undefined) {
				const scopeDenied = checkWrite(c, tenant)
				if (scopeDenied) {
					return scopeDenied
				}
			}
			return sendRow(c, updateInterface(param.id, param.ifaceId, c.req.valid('json')))
		},
	)
	// Convenience connect: one end in the path, the peer in the body.
	.post(
		'/:id/interfaces/:ifaceId/connect',
		requireWriteMiddleware,
		vValidator('param', DeviceIfaceParamsSchema, onValidationError),
		vValidator('json', InterfaceConnectSchema, onValidationError),
		(c) => {
			const param = c.req.valid('param')
			const local = getInterface(param.id, param.ifaceId)
			if (Result.isError(local)) {
				return sendResult(c, local)
			}
			const peerTenant = interfaceTenant(c.req.valid('json').peer_interface_id)
			if (peerTenant === undefined) {
				// Unknown peer: let the service answer 404.
				return sendCreated(
					c,
					connectCable({
						a_interface_id: param.ifaceId,
						b_interface_id: c.req.valid('json').peer_interface_id,
						status: 'connected',
					}),
				)
			}
			const localTenant = deviceTenant(param.id)
			if (
				localTenant !== undefined &&
				!canWriteCable(requestUser(c), [localTenant, peerTenant])
			) {
				return sendResult(c, cableScopeDenied())
			}
			return sendCreated(
				c,
				connectCable({
					a_interface_id: param.ifaceId,
					b_interface_id: c.req.valid('json').peer_interface_id,
					status: 'connected',
				}),
			)
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
		vValidator('param', DeviceIfaceParamsSchema, onValidationError),
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
