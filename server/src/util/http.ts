import type { Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'

/**
 * Shared `{ error }` response contract.
 *
 * Every failure response uses the `{ error: string }` shape, which is the
 * only field the client reads (`client/src/api/client.ts`). Build them
 * through this helper so producers cannot drift (different key, extra
 * fields, missing status).
 */
export function jsonError(
	c: Context,
	message: string,
	status: ContentfulStatusCode,
	headers?: Record<string, string>,
): Response {
	return c.json({ error: message }, status, headers)
}

/** CSV download with shared headers. */
export function sendCsv(c: Context, csv: string, filename: string): Response {
	return c.text(csv, 200, {
		'Content-Type': 'text/csv; charset=utf-8',
		'Content-Disposition': `attachment; filename="${filename}"`,
	})
}
