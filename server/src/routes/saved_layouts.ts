import { vValidator } from '@hono/valibot-validator'
import { Hono } from 'hono'
import {
	SavedFilterDeleteQuerySchema,
	SavedFilterEntryParamsSchema,
	SavedFilterListQuerySchema,
	SavedFilterTableParamsSchema,
	SavedLayoutListSchema,
	SavedLayoutUpdateSchema,
} from 'shared/src/schemas'
import {
	deleteSavedLayout,
	getSavedLayouts,
	listSavedLayouts,
	putSavedLayouts,
	updateSavedLayout,
} from '../db/saved_layouts'
import { authMiddleware } from '../middleware/auth'
import { onValidationError } from '../middleware/validation'
import { sendResult } from '../util/result_response'

/**
 * Saved DataTable column layouts per table, global for all users like the
 * saved filters (same table key, entry and query params): any signed-in
 * user may read and replace them. `GET /` lists them across tables for the
 * management page, which edits or deletes single entries by `/:table/:position`.
 */
export const savedLayoutsApp = new Hono()
	.use(authMiddleware)
	.get('/', vValidator('query', SavedFilterListQuerySchema, onValidationError), async (c) => {
		const query = c.req.valid('query')
		return sendResult(
			c,
			await listSavedLayouts({
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
			return sendResult(c, await getSavedLayouts(c.req.valid('param').table))
		},
	)
	.put(
		'/:table',
		vValidator('param', SavedFilterTableParamsSchema, onValidationError),
		vValidator('json', SavedLayoutListSchema, onValidationError),
		async (c) => {
			return sendResult(
				c,
				await putSavedLayouts(c.req.valid('param').table, c.req.valid('json')),
			)
		},
	)
	.put(
		'/:table/:position',
		vValidator('param', SavedFilterEntryParamsSchema, onValidationError),
		vValidator('json', SavedLayoutUpdateSchema, onValidationError),
		async (c) => {
			const { table, position } = c.req.valid('param')
			const body = c.req.valid('json')
			return sendResult(
				c,
				await updateSavedLayout(table, position, body.current_name, body.layout),
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
				await deleteSavedLayout(table, position, c.req.valid('query').name),
			)
		},
	)
