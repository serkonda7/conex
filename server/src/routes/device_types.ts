import { vValidator } from '@hono/valibot-validator'
import { Result } from 'better-result'
import { Hono } from 'hono'
import {
	DeviceTypeCreateSchema,
	DeviceTypeListQuerySchema,
	DeviceTypeUpdateSchema,
	EntityParamsSchema,
	IdSchema,
	StubCreateSchema,
	StubPreviewBodySchema,
	StubPreviewQuerySchema,
	StubUpdateSchema,
	YamlImportBodySchema,
} from 'shared/src/schemas'
import * as v from 'valibot'
import { requireGlobalWrite } from '../authz'
import { exportDeviceTypesCsv, importDeviceTypesYaml } from '../db/csv_transfer'
import {
	createDeviceType,
	createStub,
	deleteDeviceType,
	deleteStub,
	getDeviceType,
	getStub,
	listDeviceTypes,
	listStubs,
	previewDeviceType,
	previewStub,
	updateDeviceType,
	updateStub,
} from '../db/templates'
import { authMiddleware } from '../middleware/auth'
import { onValidationError } from '../middleware/validation'
import { sendResult } from '../util/result_response'

const stubIdParamsSchema = v.object({ id: IdSchema, stubId: IdSchema })

export const deviceTypesApp = new Hono()
	.use(authMiddleware)
	// Ad-hoc preview (`?prefix=eth&count=24&kind=ethernet`) without storing a
	// stub. Registered before `/:id` so "preview" is not parsed as an id.
	.get('/preview', vValidator('query', StubPreviewQuerySchema, onValidationError), (c) => {
		const query = c.req.valid('query')
		return sendResult(c, previewStub(query.prefix, query.count, query.kind))
	})
	.post('/preview', vValidator('json', StubPreviewBodySchema, onValidationError), (c) => {
		const body = c.req.valid('json')
		return sendResult(c, previewStub(body.prefix, body.count ?? 1, body.kind ?? 'ethernet'))
	})
	.get('/', vValidator('query', DeviceTypeListQuerySchema, onValidationError), (c) => {
		const query = c.req.valid('query')
		return c.json(
			listDeviceTypes({
				search: query.search,
				page: query.page,
				limit: query.limit,
				manufacturer: query.manufacturer,
				sort: query.sort,
				order: query.order,
			}),
		)
	})
	.post('/', vValidator('json', DeviceTypeCreateSchema, onValidationError), (c) => {
		const denied = requireGlobalWrite(c)
		if (denied) {
			return denied
		}
		const result = createDeviceType(c.req.valid('json'))
		if (Result.isOk(result)) {
			return c.json(result.value, 201)
		}
		return sendResult(c, result)
	})
	// Transfer (registered before `/:id` so the literal paths win).
	.get('/export', (c) => {
		return c.text(exportDeviceTypesCsv(), 200, {
			'Content-Type': 'text/csv; charset=utf-8',
			'Content-Disposition': 'attachment; filename="device-types.csv"',
		})
	})
	.post('/import', vValidator('json', YamlImportBodySchema, onValidationError), (c) => {
		const denied = requireGlobalWrite(c)
		if (denied) {
			return denied
		}
		const result = importDeviceTypesYaml(c.req.valid('json').yaml)
		if (Result.isOk(result)) {
			return c.json(result.value, 201)
		}
		return sendResult(c, result)
	})
	.get('/:id', vValidator('param', EntityParamsSchema, onValidationError), (c) => {
		return sendResult(c, getDeviceType(c.req.valid('param').id))
	})
	.patch(
		'/:id',
		vValidator('param', EntityParamsSchema, onValidationError),
		vValidator('json', DeviceTypeUpdateSchema, onValidationError),
		(c) => {
			const denied = requireGlobalWrite(c)
			if (denied) {
				return denied
			}
			const result = updateDeviceType(c.req.valid('param').id, c.req.valid('json'))
			if (Result.isOk(result)) {
				return c.json(result.value)
			}
			return sendResult(c, result)
		},
	)
	.delete('/:id', vValidator('param', EntityParamsSchema, onValidationError), (c) => {
		const denied = requireGlobalWrite(c)
		if (denied) {
			return denied
		}
		const result = deleteDeviceType(c.req.valid('param').id)
		if (Result.isOk(result)) {
			return c.json(result.value)
		}
		return sendResult(c, result)
	})
	// Stored-stub expansion for one device type.
	.get('/:id/preview', vValidator('param', EntityParamsSchema, onValidationError), (c) => {
		return sendResult(c, previewDeviceType(c.req.valid('param').id))
	})
	// Stub sub-resource.
	.get('/:id/stubs', vValidator('param', EntityParamsSchema, onValidationError), (c) => {
		return sendResult(c, listStubs(c.req.valid('param').id))
	})
	.post(
		'/:id/stubs',
		vValidator('param', EntityParamsSchema, onValidationError),
		vValidator('json', StubCreateSchema, onValidationError),
		(c) => {
			const denied = requireGlobalWrite(c)
			if (denied) {
				return denied
			}
			const result = createStub(c.req.valid('param').id, c.req.valid('json'))
			if (Result.isOk(result)) {
				return c.json(result.value, 201)
			}
			return sendResult(c, result)
		},
	)
	.patch(
		'/:id/stubs/:stubId',
		vValidator('param', stubIdParamsSchema, onValidationError),
		vValidator('json', StubUpdateSchema, onValidationError),
		(c) => {
			// The `:id` segment is validated as an id; ownership is enforced by
			// loading the stub itself.
			const denied = requireGlobalWrite(c)
			if (denied) {
				return denied
			}
			const result = updateStub(c.req.valid('param').stubId, c.req.valid('json'))
			if (Result.isOk(result)) {
				return c.json(result.value)
			}
			return sendResult(c, result)
		},
	)
	.delete(
		'/:id/stubs/:stubId',
		vValidator('param', stubIdParamsSchema, onValidationError),
		(c) => {
			const denied = requireGlobalWrite(c)
			if (denied) {
				return denied
			}
			const result = deleteStub(c.req.valid('param').stubId)
			if (Result.isOk(result)) {
				return c.json(result.value)
			}
			return sendResult(c, result)
		},
	)
	.get('/:id/stubs/:stubId', vValidator('param', stubIdParamsSchema, onValidationError), (c) => {
		return sendResult(c, getStub(c.req.valid('param').stubId))
	})
