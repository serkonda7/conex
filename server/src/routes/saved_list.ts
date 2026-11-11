import { vValidator } from '@hono/valibot-validator'
import { Hono } from 'hono'
import {
	SavedFilterDeleteQuerySchema,
	SavedFilterEntryParamsSchema,
	SavedFilterListQuerySchema,
	SavedFilterTableParamsSchema,
	type SavedListEntryBase,
} from 'shared/src/schemas'
import type * as v from 'valibot'
import type { SavedListStore } from '../db/saved_list'
import { authMiddleware } from '../middleware/auth'
import { onValidationError } from '../middleware/validation'
import { sendResult } from '../util/result_response'

/**
 * Routes of one saved-list store, global for all users: any signed-in user
 * may read and replace a table's list (it holds UI state only, no data).
 * `GET /` lists them across tables for the management page, which edits or
 * deletes single entries by `/:table/:position`. `listSchema` validates a
 * whole list, `updateSchema` one entry's replacement, from which `itemOf`
 * picks the new item.
 */
// biome-ignore lint/nursery/useExplicitType: return type intentionally inferred — naming it erases chained-route generics
// biome-ignore lint/nursery/useExplicitReturnType: return type intentionally inferred — naming it erases chained-route generics
export function savedListApp<
	T extends { name: string },
	E extends SavedListEntryBase,
	L extends v.GenericSchema<unknown, T[]>,
	U extends v.GenericSchema<unknown, { current_name: string }>,
>(opts: {
	store: SavedListStore<T, E>
	listSchema: L
	updateSchema: U
	itemOf: (body: v.InferOutput<U>) => T
}) {
	const { store } = opts
	return new Hono()
		.use(authMiddleware)
		.get('/', vValidator('query', SavedFilterListQuerySchema, onValidationError), async (c) => {
			const { search, page, limit, table } = c.req.valid('query')
			return sendResult(c, await store.list({ search, page, limit, table }))
		})
		.get(
			'/:table',
			vValidator('param', SavedFilterTableParamsSchema, onValidationError),
			async (c) => sendResult(c, await store.get(c.req.valid('param').table)),
		)
		.put(
			'/:table',
			vValidator('param', SavedFilterTableParamsSchema, onValidationError),
			vValidator('json', opts.listSchema, onValidationError),
			async (c) =>
				sendResult(
					c,
					await store.put(c.req.valid('param').table, c.req.valid('json') as T[]),
				),
		)
		.put(
			'/:table/:position',
			vValidator('param', SavedFilterEntryParamsSchema, onValidationError),
			vValidator('json', opts.updateSchema, onValidationError),
			async (c) => {
				const { table, position } = c.req.valid('param')
				const body = c.req.valid('json') as v.InferOutput<U>
				return sendResult(
					c,
					await store.update(table, position, body.current_name, opts.itemOf(body)),
				)
			},
		)
		.delete(
			'/:table/:position',
			vValidator('param', SavedFilterEntryParamsSchema, onValidationError),
			vValidator('query', SavedFilterDeleteQuerySchema, onValidationError),
			async (c) => {
				const { table, position } = c.req.valid('param')
				return sendResult(c, await store.delete(table, position, c.req.valid('query').name))
			},
		)
}
