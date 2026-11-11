import { vValidator } from '@hono/valibot-validator'
import { Hono } from 'hono'
import {
	SavedFilterDeleteQuerySchema,
	SavedFilterEntryParamsSchema,
	SavedFilterListQuerySchema,
	SavedFilterListSchema,
	SavedFilterTableParamsSchema,
	SavedFilterUpdateSchema,
} from 'shared/src/schemas'
import {
	deleteSavedFilter,
	getSavedFilters,
	listSavedFilters,
	putSavedFilters,
	updateSavedFilter,
} from '../db/saved_filters'
import { authMiddleware } from '../middleware/auth'
import { onValidationError } from '../middleware/validation'
import { sendResult } from '../util/result_response'

/**
 * Saved FilterTable filters per table, global for all users: any signed-in
 * user may read and replace them (they hold filter values only, no data).
 * `GET /` lists them across tables for the management page, which edits or
 * deletes single entries by `/:table/:position`.
 */
export const savedFiltersApp = new Hono()
	.use(authMiddleware)
	.get('/', vValidator('query', SavedFilterListQuerySchema, onValidationError), async (c) => {
		const query = c.req.valid('query')
		return sendResult(
			c,
			await listSavedFilters({
				search: query.search,
				page: query.page,
				limit: query.limit,
				table: query.table,
			}),
		)
	})
	.get(
		'/:table',
		vValidator('param', SavedFilterTableParamsSchema, onValidationError),
		async (c) => {
			return sendResult(c, await getSavedFilters(c.req.valid('param').table))
		},
	)
	.put(
		'/:table',
		vValidator('param', SavedFilterTableParamsSchema, onValidationError),
		vValidator('json', SavedFilterListSchema, onValidationError),
		async (c) => {
			return sendResult(
				c,
				await putSavedFilters(c.req.valid('param').table, c.req.valid('json')),
			)
		},
	)
	.put(
		'/:table/:position',
		vValidator('param', SavedFilterEntryParamsSchema, onValidationError),
		vValidator('json', SavedFilterUpdateSchema, onValidationError),
		async (c) => {
			const { table, position } = c.req.valid('param')
			const body = c.req.valid('json')
			return sendResult(
				c,
				await updateSavedFilter(table, position, body.current_name, body.filter),
			)
		},
	)
	.delete(
		'/:table/:position',
		vValidator('param', SavedFilterEntryParamsSchema, onValidationError),
		vValidator('query', SavedFilterDeleteQuerySchema, onValidationError),
		async (c) => {
			const { table, position } = c.req.valid('param')
			return sendResult(
				c,
				await deleteSavedFilter(table, position, c.req.valid('query').name),
			)
		},
	)
