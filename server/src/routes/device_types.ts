import { vValidator } from '@hono/valibot-validator'
import { Hono } from 'hono'
import {
	DeviceTypeCreateSchema,
	DeviceTypeListQuerySchema,
	DeviceTypeUpdateSchema,
	EntityParamsSchema,
	StubCreateSchema,
	StubIdParamsSchema,
	StubUpdateSchema,
	YamlImportBodySchema,
} from 'shared/src/schemas'
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
	updateDeviceType,
	updateStub,
} from '../db/templates'
import { authMiddleware } from '../middleware/auth'
import { requireGlobalWriteMiddleware } from '../middleware/roles'
import { onValidationError } from '../middleware/validation'
import { sendResult } from '../util/result_response'
import { sendCreated, sendCsv, sendRow } from './helpers'

export const deviceTypesApp = new Hono()
	.use(authMiddleware)
	.get('/', vValidator('query', DeviceTypeListQuerySchema, onValidationError), (c) => {
		const query = c.req.valid('query')
		return c.json(
			listDeviceTypes({
				search: query.search,
				page: query.page,
				limit: query.limit,
				manufacturer: query.manufacturer,
				kind: query.kind,
				sort: query.sort,
				order: query.order,
			}),
		)
	})
	.post(
		'/',
		requireGlobalWriteMiddleware,
		vValidator('json', DeviceTypeCreateSchema, onValidationError),
		(c) => {
			return sendCreated(c, createDeviceType(c.req.valid('json')))
		},
	)
	// Transfer (registered before `/:id` so the literal paths win).
	.get('/export', (c) => {
		return sendCsv(c, exportDeviceTypesCsv(), 'device-types.csv')
	})
	.post(
		'/import',
		requireGlobalWriteMiddleware,
		vValidator('json', YamlImportBodySchema, onValidationError),
		(c) => {
			return sendCreated(c, importDeviceTypesYaml(c.req.valid('json').yaml))
		},
	)
	.get('/:id', vValidator('param', EntityParamsSchema, onValidationError), (c) => {
		return sendResult(c, getDeviceType(c.req.valid('param').id))
	})
	.patch(
		'/:id',
		requireGlobalWriteMiddleware,
		vValidator('param', EntityParamsSchema, onValidationError),
		vValidator('json', DeviceTypeUpdateSchema, onValidationError),
		(c) => {
			return sendRow(c, updateDeviceType(c.req.valid('param').id, c.req.valid('json')))
		},
	)
	.delete(
		'/:id',
		requireGlobalWriteMiddleware,
		vValidator('param', EntityParamsSchema, onValidationError),
		(c) => {
			return sendRow(c, deleteDeviceType(c.req.valid('param').id))
		},
	)
	// Stub sub-resource.
	.get('/:id/stubs', vValidator('param', EntityParamsSchema, onValidationError), (c) => {
		return sendResult(c, listStubs(c.req.valid('param').id))
	})
	.post(
		'/:id/stubs',
		requireGlobalWriteMiddleware,
		vValidator('param', EntityParamsSchema, onValidationError),
		vValidator('json', StubCreateSchema, onValidationError),
		(c) => {
			return sendCreated(c, createStub(c.req.valid('param').id, c.req.valid('json')))
		},
	)
	.patch(
		'/:id/stubs/:stubId',
		requireGlobalWriteMiddleware,
		vValidator('param', StubIdParamsSchema, onValidationError),
		vValidator('json', StubUpdateSchema, onValidationError),
		(c) => {
			// The `:id` segment is validated as an id; ownership is enforced by
			// loading the stub itself.
			return sendRow(c, updateStub(c.req.valid('param').stubId, c.req.valid('json')))
		},
	)
	.delete(
		'/:id/stubs/:stubId',
		requireGlobalWriteMiddleware,
		vValidator('param', StubIdParamsSchema, onValidationError),
		(c) => {
			return sendRow(c, deleteStub(c.req.valid('param').stubId))
		},
	)
	.get('/:id/stubs/:stubId', vValidator('param', StubIdParamsSchema, onValidationError), (c) => {
		return sendResult(c, getStub(c.req.valid('param').stubId))
	})
