import { vValidator } from '@hono/valibot-validator'
import { Hono } from 'hono'
import { SavedFilterListSchema, SavedFilterTableParamsSchema } from 'shared/src/schemas'
import { getSavedFilters, putSavedFilters } from '../db/saved_filters'
import { authMiddleware } from '../middleware/auth'
import { onValidationError } from '../middleware/validation'
import { sendResult } from '../util/result_response'

/**
 * Saved FilterTable filters per table, global for all users: any signed-in
 * user may read and replace them (they hold filter values only, no data).
 */
export const savedFiltersApp = new Hono()
	.use(authMiddleware)
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
