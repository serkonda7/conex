import { Result } from 'better-result'
import type { Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { ConflictError, DuplicateError, ForbiddenError, NotFoundError } from '../db/errors'
import { jsonError } from './http'

/**
 * Sends a service `Result` as JSON. Success serializes the value; known
 * domain errors map to 404/409 through the shared `{ error }` shape and
 * unexpected failures stay a 500 (logged server-side).
 */
export function sendResult<T>(
	c: Context,
	result: Result<T, Error>,
	status: ContentfulStatusCode = 200,
): Response {
	if (Result.isOk(result)) {
		return c.json(result.value, status)
	}
	const err = result.error
	if (err instanceof NotFoundError) {
		return jsonError(c, err.message, 404)
	}
	if (err instanceof ForbiddenError) {
		return jsonError(c, err.message, 403)
	}
	if (err instanceof DuplicateError || err instanceof ConflictError) {
		return jsonError(c, err.message, 409)
	}
	console.error(err)
	return jsonError(c, 'Internal server error', 500)
}
