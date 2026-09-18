import { vValidator } from '@hono/valibot-validator'
import { Result } from 'better-result'
import { Hono } from 'hono'
import {
	DeviceCreateSchema,
	DeviceListQuerySchema,
	DeviceMoveSchema,
	DeviceUpdateSchema,
	EntityParamsSchema,
	IdSchema,
	InterfaceCreateSchema,
	InterfaceUpdateSchema,
} from 'shared/src/schemas'
import * as v from 'valibot'
import { logAccess } from '../audit'
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
import { authMiddleware } from '../middleware/auth'
import { onValidationError } from '../middleware/validation'
import { sendResult } from '../util/result_response'

const deviceIfaceParamsSchema = v.object({ id: IdSchema, ifaceId: IdSchema })

export const devicesApp = new Hono()
	.use(authMiddleware)
	.get('/', vValidator('query', DeviceListQuerySchema, onValidationError), (c) => {
		const query = c.req.valid('query')
		return c.json(
			listDevices({
				search: query.search,
				page: query.page,
				limit: query.limit,
				site: query.site,
				rack: query.rack,
				tenant: query.tenant,
				status: query.status,
			}),
		)
	})
	.post('/', vValidator('json', DeviceCreateSchema, onValidationError), (c) => {
		const result = createDevice(c.req.valid('json'))
		if (Result.isOk(result)) {
			logAccess(c, 'device.create', result.value.id)
			return c.json(result.value, 201)
		}
		return sendResult(c, result)
	})
	.get('/:id', vValidator('param', EntityParamsSchema, onValidationError), (c) => {
		return sendResult(c, getDevice(c.req.valid('param').id))
	})
	.patch(
		'/:id',
		vValidator('param', EntityParamsSchema, onValidationError),
		vValidator('json', DeviceUpdateSchema, onValidationError),
		(c) => {
			const result = updateDevice(c.req.valid('param').id, c.req.valid('json'))
			if (Result.isOk(result)) {
				logAccess(c, 'device.update', result.value.id)
				return c.json(result.value)
			}
			return sendResult(c, result)
		},
	)
	.delete('/:id', vValidator('param', EntityParamsSchema, onValidationError), (c) => {
		const result = deleteDevice(c.req.valid('param').id)
		if (Result.isOk(result)) {
			logAccess(c, 'device.delete', result.value.id)
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
			const result = moveDevice(c.req.valid('param').id, c.req.valid('json'))
			if (Result.isOk(result)) {
				logAccess(c, 'device.move', result.value.id)
				return c.json(result.value)
			}
			return sendResult(c, result)
		},
	)
	// Interface sub-resource (name unique per device; `connected` is P5-owned).
	.get('/:id/interfaces', vValidator('param', EntityParamsSchema, onValidationError), (c) => {
		return sendResult(c, listInterfaces(c.req.valid('param').id))
	})
	.post(
		'/:id/interfaces',
		vValidator('param', EntityParamsSchema, onValidationError),
		vValidator('json', InterfaceCreateSchema, onValidationError),
		(c) => {
			const result = addInterface(c.req.valid('param').id, c.req.valid('json'))
			if (Result.isOk(result)) {
				logAccess(c, 'device-interface.create', result.value.id)
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
			return sendResult(c, getInterface(param.id, param.ifaceId))
		},
	)
	.patch(
		'/:id/interfaces/:ifaceId',
		vValidator('param', deviceIfaceParamsSchema, onValidationError),
		vValidator('json', InterfaceUpdateSchema, onValidationError),
		(c) => {
			const param = c.req.valid('param')
			const result = updateInterface(param.id, param.ifaceId, c.req.valid('json'))
			if (Result.isOk(result)) {
				logAccess(c, 'device-interface.update', result.value.id)
				return c.json(result.value)
			}
			return sendResult(c, result)
		},
	)
