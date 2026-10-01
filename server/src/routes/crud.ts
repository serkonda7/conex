import { vValidator } from '@hono/valibot-validator'
import { Result } from 'better-result'
import { Hono } from 'hono'
import type * as v from 'valibot'
import {
	checkTenant,
	checkUpdateTenant,
	listTenantScope,
	resolveCreateTenant,
	sendTenantRow,
} from '../authz'
import { authMiddleware } from '../middleware/auth'
import {
	requireGlobalPermissionMiddleware,
	requirePermissionMiddleware,
} from '../middleware/permissions'
import { onValidationError } from '../middleware/validation'
import { sendCreated, sendResult } from '../util/result_response'

interface CrudOptions<Row> {
	listQuerySchema: v.GenericSchema
	createSchema: v.GenericSchema
	updateSchema: v.GenericSchema
	paramSchema: v.GenericSchema
	// biome-ignore lint/suspicious/noExplicitAny: factory bridges heterogeneous db signatures
	list: (params: any) => Promise<unknown>
	// biome-ignore lint/suspicious/noExplicitAny: factory bridges heterogeneous db signatures
	create: (input: any) => Promise<Result<unknown, Error>>
	get: (id: number) => Promise<Result<Row, Error>>
	// biome-ignore lint/suspicious/noExplicitAny: factory bridges heterogeneous db signatures
	update: (id: number, input: any) => Promise<Result<unknown, Error>>
	remove: (id: number) => Promise<Result<unknown, Error>>
	/** Extra list filters picked from the validated query, e.g. `(q) => ({ group: q.group })`. */
	// biome-ignore lint/suspicious/noExplicitAny: validated query shapes vary per entity
	filters?: (query: any) => Record<string, unknown>
}

interface ListQuery extends Record<string, unknown> {
	search: string
	page: number
	limit: number
	sort: string
	order: 'asc' | 'desc'
	tenant?: number
	tenant_group?: number
}

/** Common list params plus the entity's extra filters. */
function listParams<Row>(opts: CrudOptions<Row>, query: ListQuery): Record<string, unknown> {
	return {
		search: query.search,
		page: query.page,
		limit: query.limit,
		sort: query.sort,
		order: query.order,
		...(opts.filters?.(query) ?? {}),
	}
}

/** Five-route tenant-bearing CRUD: list/create/get/patch/delete with shared gates. */
// biome-ignore lint/nursery/useExplicitType: return type intentionally inferred — naming it erases chained-route generics
// biome-ignore lint/nursery/useExplicitReturnType: return type intentionally inferred — naming it erases chained-route generics
export function makeTenantApp(
	opts: CrudOptions<{ tenant_id: number | null } & Record<string, unknown>>,
) {
	return new Hono()
		.use(authMiddleware)
		.use(requirePermissionMiddleware('view'))
		.get('/', vValidator('query', opts.listQuerySchema, onValidationError), async (c) => {
			const query = c.req.valid('query') as ListQuery
			const scope = await listTenantScope(c, query.tenant, query.tenant_group)
			if (scope instanceof Response) {
				return scope
			}
			return c.json((await opts.list({ ...listParams(opts, query), ...scope })) as object)
		})
		.post(
			'/',
			requirePermissionMiddleware('edit'),
			vValidator('json', opts.createSchema, onValidationError),
			async (c) => {
				const body = c.req.valid('json') as Record<string, unknown> & {
					tenant_id?: number | null
				}
				const tenant = resolveCreateTenant(c, body.tenant_id)
				if (tenant instanceof Response) {
					return tenant
				}
				return sendCreated(c, await opts.create({ ...body, tenant_id: tenant }))
			},
		)
		.get('/:id', vValidator('param', opts.paramSchema, onValidationError), async (c) => {
			const { id } = c.req.valid('param') as { id: number }
			return sendTenantRow(c, await opts.get(id))
		})
		.patch(
			'/:id',
			requirePermissionMiddleware('edit'),
			vValidator('param', opts.paramSchema, onValidationError),
			vValidator('json', opts.updateSchema, onValidationError),
			async (c) => {
				const { id } = c.req.valid('param') as { id: number }
				const body = c.req.valid('json') as { tenant_id?: number | null }
				const current = await opts.get(id)
				if (Result.isError(current)) {
					return sendResult(c, current)
				}
				return (
					checkUpdateTenant(c, current.value.tenant_id, body.tenant_id) ??
					sendResult(c, await opts.update(id, body))
				)
			},
		)
		.delete(
			'/:id',
			requirePermissionMiddleware('delete'),
			vValidator('param', opts.paramSchema, onValidationError),
			async (c) => {
				const { id } = c.req.valid('param') as { id: number }
				const current = await opts.get(id)
				if (Result.isError(current)) {
					return sendResult(c, current)
				}
				return (
					checkTenant(c, current.value.tenant_id) ?? sendResult(c, await opts.remove(id))
				)
			},
		)
}

/** Five-route shared-catalog CRUD: readable by all, writable by global editors. */
// biome-ignore lint/nursery/useExplicitType: return type intentionally inferred — naming it erases chained-route generics
// biome-ignore lint/nursery/useExplicitReturnType: return type intentionally inferred — naming it erases chained-route generics
export function makeCatalogApp(opts: CrudOptions<unknown>) {
	return new Hono()
		.use(authMiddleware)
		.use(requirePermissionMiddleware('view'))
		.get('/', vValidator('query', opts.listQuerySchema, onValidationError), async (c) => {
			const query = c.req.valid('query') as ListQuery
			return c.json((await opts.list(listParams(opts, query))) as object)
		})
		.post(
			'/',
			requireGlobalPermissionMiddleware('edit'),
			vValidator('json', opts.createSchema, onValidationError),
			async (c) => sendCreated(c, await opts.create(c.req.valid('json'))),
		)
		.get('/:id', vValidator('param', opts.paramSchema, onValidationError), async (c) => {
			const { id } = c.req.valid('param') as { id: number }
			return sendResult(c, await opts.get(id))
		})
		.patch(
			'/:id',
			requireGlobalPermissionMiddleware('edit'),
			vValidator('param', opts.paramSchema, onValidationError),
			vValidator('json', opts.updateSchema, onValidationError),
			async (c) => {
				const { id } = c.req.valid('param') as { id: number }
				return sendResult(c, await opts.update(id, c.req.valid('json')))
			},
		)
		.delete(
			'/:id',
			requireGlobalPermissionMiddleware('delete'),
			vValidator('param', opts.paramSchema, onValidationError),
			async (c) => {
				const { id } = c.req.valid('param') as { id: number }
				return sendResult(c, await opts.remove(id))
			},
		)
}
