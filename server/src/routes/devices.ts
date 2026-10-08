import { vValidator } from '@hono/valibot-validator'
import { Result } from 'better-result'
import { type Context, Hono } from 'hono'
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
	checkCable,
	checkTenant,
	checkUpdateTenant,
	listTenantScope,
	requestScope,
	resolveCreateTenant,
	sendTenantRow,
} from '../authz'
import { connectCable } from '../db/cables'
import { exportDevicesCsv, importDevicesCsv } from '../db/csv_transfer'
import {
	addInterface,
	createDevice,
	type DeviceRow,
	deleteDevice,
	getDevice,
	getInterface,
	listDevices,
	listInterfaces,
	moveDevice,
	updateDevice,
	updateInterface,
} from '../db/devices'
import { deviceTenant, interfaceTenant } from '../db/owners'
import { getDeviceTrace, getInterfaceTrace } from '../db/trace'
import { authMiddleware } from '../middleware/auth'
import { requirePermissionMiddleware } from '../middleware/permissions'
import { onValidationError } from '../middleware/validation'
import { sendCsv } from '../util/http'
import { sendCreated, sendResult } from '../util/result_response'

/** Loads a device the requester may access: the row, or the 404/403 response. */
async function loadDevice(c: Context, id: number): Promise<DeviceRow | Response> {
	const device = await getDevice(id)
	if (Result.isError(device)) {
		return sendResult(c, device)
	}
	return checkTenant(c, device.value.tenant_id) ?? device.value
}

/**
 * Devices are tenant-bearing; interfaces inherit their device's tenant.
 * CSV export is a filtered read, CSV import a scoped write (rows outside
 * the scope fail per-row in `db/csv_transfer.ts`). Sub-resource routes of a
 * missing device fall through to the service 404.
 */
export const devicesApp = new Hono()
	.use(authMiddleware)
	.use(requirePermissionMiddleware('view'))
	.get('/', vValidator('query', DeviceListQuerySchema, onValidationError), async (c) => {
		const query = c.req.valid('query')
		const scope = await listTenantScope(c, query.tenant, query.tenant_group)
		if (scope instanceof Response) {
			return scope
		}
		return c.json(
			await listDevices({
				search: query.search,
				page: query.page,
				limit: query.limit,
				site: query.site,
				rack: query.rack,
				role: query.role,
				device_type: query.device_type,
				status: query.status,
				placed: query.placed,
				sort: query.sort,
				order: query.order,
				...scope,
			}),
		)
	})
	.post(
		'/',
		requirePermissionMiddleware('edit'),
		vValidator('json', DeviceCreateSchema, onValidationError),
		async (c) => {
			const body = c.req.valid('json')
			const tenant = resolveCreateTenant(c, body.tenant_id)
			if (tenant instanceof Response) {
				return tenant
			}
			return sendCreated(c, await createDevice({ ...body, tenant_id: tenant }))
		},
	)
	// CSV transfer (registered before `/:id` so the literal paths win).
	.get('/export', async (c) => {
		return sendCsv(c, await exportDevicesCsv(requestScope(c)), 'devices.csv')
	})
	.post(
		'/import',
		requirePermissionMiddleware('edit'),
		vValidator('json', CsvImportBodySchema, onValidationError),
		async (c) => {
			return sendCreated(c, await importDevicesCsv(c.req.valid('json').csv, requestScope(c)))
		},
	)
	.get('/:id', vValidator('param', EntityParamsSchema, onValidationError), async (c) => {
		return sendTenantRow(c, await getDevice(c.req.valid('param').id))
	})
	.patch(
		'/:id',
		requirePermissionMiddleware('edit'),
		vValidator('param', EntityParamsSchema, onValidationError),
		vValidator('json', DeviceUpdateSchema, onValidationError),
		async (c) => {
			const id = c.req.valid('param').id
			const body = c.req.valid('json')
			const current = await getDevice(id)
			if (Result.isError(current)) {
				return sendResult(c, current)
			}
			return (
				checkUpdateTenant(c, current.value.tenant_id, body.tenant_id) ??
				sendResult(c, await updateDevice(id, body))
			)
		},
	)
	.delete(
		'/:id',
		requirePermissionMiddleware('delete'),
		vValidator('param', EntityParamsSchema, onValidationError),
		async (c) => {
			const id = c.req.valid('param').id
			const device = await loadDevice(c, id)
			if (device instanceof Response) {
				return device
			}
			return sendResult(c, await deleteDevice(id))
		},
	)
	// Explicit remount: re-validates U exactly like creation.
	.post(
		'/:id/move',
		requirePermissionMiddleware('edit'),
		vValidator('param', EntityParamsSchema, onValidationError),
		vValidator('json', DeviceMoveSchema, onValidationError),
		async (c) => {
			const id = c.req.valid('param').id
			const device = await loadDevice(c, id)
			if (device instanceof Response) {
				return device
			}
			return sendResult(c, await moveDevice(id, c.req.valid('json')))
		},
	)
	// Interface sub-resource (name unique per device; `connected` is P5-owned).
	.get(
		'/:id/interfaces',
		vValidator('param', EntityParamsSchema, onValidationError),
		async (c) => {
			const id = c.req.valid('param').id
			return checkTenant(c, await deviceTenant(id)) ?? sendResult(c, await listInterfaces(id))
		},
	)
	.post(
		'/:id/interfaces',
		requirePermissionMiddleware('edit'),
		vValidator('param', EntityParamsSchema, onValidationError),
		vValidator('json', InterfaceCreateSchema, onValidationError),
		async (c) => {
			const id = c.req.valid('param').id
			return (
				checkTenant(c, await deviceTenant(id)) ??
				sendCreated(c, await addInterface(id, c.req.valid('json')))
			)
		},
	)
	.get(
		'/:id/interfaces/:ifaceId',
		vValidator('param', DeviceIfaceParamsSchema, onValidationError),
		async (c) => {
			const param = c.req.valid('param')
			const local = await getInterface(param.id, param.ifaceId)
			if (Result.isError(local)) {
				return sendResult(c, local)
			}
			return checkTenant(c, await deviceTenant(param.id)) ?? c.json(local.value)
		},
	)
	.patch(
		'/:id/interfaces/:ifaceId',
		requirePermissionMiddleware('edit'),
		vValidator('param', DeviceIfaceParamsSchema, onValidationError),
		vValidator('json', InterfaceUpdateSchema, onValidationError),
		async (c) => {
			const param = c.req.valid('param')
			return (
				checkTenant(c, await deviceTenant(param.id)) ??
				sendResult(c, await updateInterface(param.id, param.ifaceId, c.req.valid('json')))
			)
		},
	)
	// Convenience connect: one end in the path, the peer in the body.
	.post(
		'/:id/interfaces/:ifaceId/connect',
		requirePermissionMiddleware('edit'),
		vValidator('param', DeviceIfaceParamsSchema, onValidationError),
		vValidator('json', InterfaceConnectSchema, onValidationError),
		async (c) => {
			const param = c.req.valid('param')
			const local = await getInterface(param.id, param.ifaceId)
			if (Result.isError(local)) {
				return sendResult(c, local)
			}
			const peerId = c.req.valid('json').peer_interface_id
			// An unknown peer falls through to the service 404.
			const peerTenant = await interfaceTenant(peerId)
			const localTenant = await deviceTenant(param.id)
			if (peerTenant !== undefined && localTenant !== undefined) {
				const denied = checkCable(c, [localTenant, peerTenant])
				if (denied) {
					return denied
				}
			}
			return sendCreated(
				c,
				await connectCable({
					a_interface_id: param.ifaceId,
					b_interface_id: peerId,
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
		async (c) => {
			const id = c.req.valid('param').id
			return (
				checkTenant(c, await deviceTenant(id)) ??
				sendResult(c, await getDeviceTrace(id, c.req.valid('query').depth, requestScope(c)))
			)
		},
	)
	// Per-interface cable trace: all shortest paths starting at one port.
	.get(
		'/:id/interfaces/:ifaceId/trace',
		vValidator('param', DeviceIfaceParamsSchema, onValidationError),
		vValidator('query', TraceQuerySchema, onValidationError),
		async (c) => {
			const param = c.req.valid('param')
			return (
				checkTenant(c, await deviceTenant(param.id)) ??
				sendResult(
					c,
					await getInterfaceTrace(
						param.id,
						param.ifaceId,
						c.req.valid('query').depth,
						requestScope(c),
					),
				)
			)
		},
	)
