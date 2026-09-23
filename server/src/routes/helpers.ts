import { Result } from 'better-result'
import type { Context } from 'hono'
import { ForbiddenError } from '../db/errors'
import { sendResult } from '../util/result_response'

export const CABLE_SCOPE_MESSAGE = 'Cable endpoints are outside your tenant scope'

export function cableScopeDenied(): Result<never, Error> {
	return Result.err(new ForbiddenError(CABLE_SCOPE_MESSAGE))
}

/** Success (200) or mapped error — replaces `if (isOk) c.json / sendResult`. */
export function sendRow<T>(c: Context, result: Result<T, Error>): Response {
	return sendResult(c, result)
}

/** Created (201) or mapped error — replaces create/import tails. */
export function sendCreated<T>(c: Context, result: Result<T, Error>): Response {
	return sendResult(c, result, 201)
}

/** CSV download with shared headers. */
export function sendCsv(c: Context, csv: string, filename: string): Response {
	return c.text(csv, 200, {
		'Content-Type': 'text/csv; charset=utf-8',
		'Content-Disposition': `attachment; filename="${filename}"`,
	})
}
