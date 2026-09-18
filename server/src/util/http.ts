/**
 * Shared `{ error }` response contract.
 *
 * Every failure response uses the `{ error: string }` shape, which is the
 * only field the client reads (`client/src/util/api_error.ts`). Build them
 * through this helper so producers cannot drift (different key, extra
 * fields, missing status).
 */
import type { Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'

export function jsonError(
	c: Context,
	message: string,
	status: ContentfulStatusCode,
	headers?: Record<string, string>,
): Response {
	return c.json({ error: message }, status, headers)
}
