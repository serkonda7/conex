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
import {
	requireGlobalPermissionMiddleware,
	requirePermissionMiddleware,
} from '../middleware/permissions'
import { onValidationError } from '../middleware/validation'
import { sendCsv } from '../util/http'
import { sendCreated, sendResult } from '../util/result_response'

export const deviceTypesApp = new Hono()
	.use(authMiddleware)
	.use(requirePermissionMiddleware('view'))
	.get('/', vValidator('query', DeviceTypeListQuerySchema, onValidationError), async (c) => {
		const query = c.req.valid('query')
		return c.json(
			await listDeviceTypes({
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
		requireGlobalPermissionMiddleware('edit'),
		vValidator('json', DeviceTypeCreateSchema, onValidationError),
		async (c) => {
			return sendCreated(c, await createDeviceType(c.req.valid('json')))
		},
	)
	// Transfer (registered before `/:id` so the literal paths win).
	.get('/export', async (c) => {
		return sendCsv(c, await exportDeviceTypesCsv(), 'device-types.csv')
	})
	.post(
		'/import',
		requireGlobalPermissionMiddleware('edit'),
		vValidator('json', YamlImportBodySchema, onValidationError),
		async (c) => {
			return sendCreated(c, await importDeviceTypesYaml(c.req.valid('json').yaml))
		},
	)
	.get('/:id', vValidator('param', EntityParamsSchema, onValidationError), async (c) => {
		return sendResult(c, await getDeviceType(c.req.valid('param').id))
	})
	.patch(
		'/:id',
		requireGlobalPermissionMiddleware('edit'),
		vValidator('param', EntityParamsSchema, onValidationError),
		vValidator('json', DeviceTypeUpdateSchema, onValidationError),
		async (c) => {
			return sendResult(
				c,
				await updateDeviceType(c.req.valid('param').id, c.req.valid('json')),
			)
		},
	)
	.delete(
		'/:id',
		requireGlobalPermissionMiddleware('delete'),
		vValidator('param', EntityParamsSchema, onValidationError),
		async (c) => {
			return sendResult(c, await deleteDeviceType(c.req.valid('param').id))
		},
	)
	// Stub sub-resource.
	.get('/:id/stubs', vValidator('param', EntityParamsSchema, onValidationError), async (c) => {
		return sendResult(c, await listStubs(c.req.valid('param').id))
	})
	.post(
		'/:id/stubs',
		requireGlobalPermissionMiddleware('edit'),
		vValidator('param', EntityParamsSchema, onValidationError),
		vValidator('json', StubCreateSchema, onValidationError),
		async (c) => {
			return sendCreated(c, await createStub(c.req.valid('param').id, c.req.valid('json')))
		},
	)
	.patch(
		'/:id/stubs/:stubId',
		requireGlobalPermissionMiddleware('edit'),
		vValidator('param', StubIdParamsSchema, onValidationError),
		vValidator('json', StubUpdateSchema, onValidationError),
		async (c) => {
			// The `:id` segment is validated as an id; ownership is enforced by
			// loading the stub itself.
			return sendResult(c, await updateStub(c.req.valid('param').stubId, c.req.valid('json')))
		},
	)
	.delete(
		'/:id/stubs/:stubId',
		requireGlobalPermissionMiddleware('delete'),
		vValidator('param', StubIdParamsSchema, onValidationError),
		async (c) => {
			return sendResult(c, await deleteStub(c.req.valid('param').stubId))
		},
	)
	.get(
		'/:id/stubs/:stubId',
		vValidator('param', StubIdParamsSchema, onValidationError),
		async (c) => {
			return sendResult(c, await getStub(c.req.valid('param').stubId))
		},
	)
