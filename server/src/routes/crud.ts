import { vValidator } from '@hono/valibot-validator'
import { Result } from 'better-result'
import { Hono } from 'hono'
import type * as v from 'valibot'
import {
	guardUpdate,
	guardWrite,
	listTenantScope,
	resolveCreateTenant,
	sendTenantRow,
} from '../authz'
import { authMiddleware } from '../middleware/auth'
import { requireGlobalWriteMiddleware, requireWriteMiddleware } from '../middleware/roles'
import { onValidationError } from '../middleware/validation'
import { sendCreated, sendRow } from './helpers'

interface TenantCrudOptions {
	listQuerySchema: v.GenericSchema
	createSchema: v.GenericSchema
	updateSchema: v.GenericSchema
	paramSchema: v.GenericSchema
	// biome-ignore lint/suspicious/noExplicitAny: factory bridges heterogeneous db signatures
	list: (params: any) => unknown
	// biome-ignore lint/suspicious/noExplicitAny: factory bridges heterogeneous db signatures
	create: (input: any) => Result<unknown, Error>
	get: (id: number) => Result<{ tenant_id: number | null } & Record<string, unknown>, Error>
	// biome-ignore lint/suspicious/noExplicitAny: factory bridges heterogeneous db signatures
	update: (id: number, input: any) => Result<unknown, Error>
	remove: (id: number) => Result<unknown, Error>
	/** Extra list filters picked from the validated query, e.g. `(q) => ({ group: q.group })`. */
	// biome-ignore lint/suspicious/noExplicitAny: validated query shapes vary per entity
	filters?: (query: any) => Record<string, unknown>
}

/** Five-route tenant-bearing CRUD: list/create/get/patch/delete with shared gates. */
// biome-ignore lint/nursery/useExplicitType: return type intentionally inferred — naming it erases chained-route generics
// biome-ignore lint/nursery/useExplicitReturnType: return type intentionally inferred — naming it erases chained-route generics
export function makeTenantApp(opts: TenantCrudOptions) {
	return new Hono()
		.use(authMiddleware)
		.get('/', vValidator('query', opts.listQuerySchema, onValidationError), (c) => {
			const query = c.req.valid('query') as Record<string, unknown> & {
				search: string
				page: number
				limit: number
				sort: string
				order: 'asc' | 'desc'
				tenant?: number
			}
			const scope = listTenantScope(c, query.tenant)
			if (scope instanceof Response) {
				return scope
			}
			return c.json(
				opts.list({
					search: query.search,
					page: query.page,
					limit: query.limit,
					sort: query.sort,
					order: query.order,
					...(opts.filters?.(query) ?? {}),
					...scope,
				}) as object,
			)
		})
		.post(
			'/',
			requireWriteMiddleware,
			vValidator('json', opts.createSchema, onValidationError),
			(c) => {
				const body = c.req.valid('json') as Record<string, unknown> & {
					tenant_id?: number | null
				}
				const tenant = resolveCreateTenant(c, body.tenant_id)
				if (tenant instanceof Response) {
					return tenant
				}
				return sendCreated(
					c,
					opts.create({ ...body, tenant_id: tenant }) as Result<never, Error>,
				)
			},
		)
		.get('/:id', vValidator('param', opts.paramSchema, onValidationError), (c) => {
			const { id } = c.req.valid('param') as { id: number }
			return sendTenantRow(c, opts.get(id) as Result<never, Error>)
		})
		.patch(
			'/:id',
			requireWriteMiddleware,
			vValidator('param', opts.paramSchema, onValidationError),
			vValidator('json', opts.updateSchema, onValidationError),
			(c) => {
				const { id } = c.req.valid('param') as { id: number }
				const body = c.req.valid('json') as Record<string, unknown> & {
					tenant_id?: number | null
				}
				const current = opts.get(id) as Result<{ tenant_id: number | null }, Error>
				if (Result.isError(current)) {
					return sendRow(c, current as Result<never, Error>)
				}
				const denied = guardUpdate(c, current.value.tenant_id, body.tenant_id)
				if (denied) {
					return denied
				}
				return sendRow(c, opts.update(id, body) as Result<never, Error>)
			},
		)
		.delete(
			'/:id',
			requireWriteMiddleware,
			vValidator('param', opts.paramSchema, onValidationError),
			(c) => {
				const { id } = c.req.valid('param') as { id: number }
				const current = opts.get(id) as Result<{ tenant_id: number | null }, Error>
				if (Result.isError(current)) {
					return sendRow(c, current as Result<never, Error>)
				}
				const denied = guardWrite(c, current.value.tenant_id)
				if (denied) {
					return denied
				}
				return sendRow(c, opts.remove(id) as Result<never, Error>)
			},
		)
}

interface CatalogCrudOptions {
	listQuerySchema: v.GenericSchema
	createSchema: v.GenericSchema
	updateSchema: v.GenericSchema
	paramSchema: v.GenericSchema
	// biome-ignore lint/suspicious/noExplicitAny: factory bridges heterogeneous db signatures
	list: (params: any) => unknown
	// biome-ignore lint/suspicious/noExplicitAny: factory bridges heterogeneous db signatures
	create: (input: any) => Result<unknown, Error>
	get: (id: number) => Result<unknown, Error>
	// biome-ignore lint/suspicious/noExplicitAny: factory bridges heterogeneous db signatures
	update: (id: number, input: any) => Result<unknown, Error>
	remove: (id: number) => Result<unknown, Error>
	// biome-ignore lint/suspicious/noExplicitAny: validated query shapes vary per entity
	filters?: (query: any) => Record<string, unknown>
}

/** Five-route shared-catalog CRUD: readable by all, writable by global editors. */
// biome-ignore lint/nursery/useExplicitType: return type intentionally inferred — naming it erases chained-route generics
// biome-ignore lint/nursery/useExplicitReturnType: return type intentionally inferred — naming it erases chained-route generics
export function makeCatalogApp(opts: CatalogCrudOptions) {
	return new Hono()
		.use(authMiddleware)
		.get('/', vValidator('query', opts.listQuerySchema, onValidationError), (c) => {
			const query = c.req.valid('query') as Record<string, unknown> & {
				search: string
				page: number
				limit: number
				sort: string
				order: 'asc' | 'desc'
			}
			return c.json(
				opts.list({
					search: query.search,
					page: query.page,
					limit: query.limit,
					sort: query.sort,
					order: query.order,
					...(opts.filters?.(query) ?? {}),
				}) as object,
			)
		})
		.post(
			'/',
			requireGlobalWriteMiddleware,
			vValidator('json', opts.createSchema, onValidationError),
			(c) => {
				return sendCreated(
					c,
					opts.create(c.req.valid('json') as Record<string, unknown>) as Result<
						never,
						Error
					>,
				)
			},
		)
		.get('/:id', vValidator('param', opts.paramSchema, onValidationError), (c) => {
			const { id } = c.req.valid('param') as { id: number }
			return sendRow(c, opts.get(id) as Result<never, Error>)
		})
		.patch(
			'/:id',
			requireGlobalWriteMiddleware,
			vValidator('param', opts.paramSchema, onValidationError),
			vValidator('json', opts.updateSchema, onValidationError),
			(c) => {
				const { id } = c.req.valid('param') as { id: number }
				return sendRow(
					c,
					opts.update(id, c.req.valid('json') as Record<string, unknown>) as Result<
						never,
						Error
					>,
				)
			},
		)
		.delete(
			'/:id',
			requireGlobalWriteMiddleware,
			vValidator('param', opts.paramSchema, onValidationError),
			(c) => {
				const { id } = c.req.valid('param') as { id: number }
				return sendRow(c, opts.remove(id) as Result<never, Error>)
			},
		)
}
