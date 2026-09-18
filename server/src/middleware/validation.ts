/** Shared plumbing for the valibot request validators used by the routes. */
import type { Context } from 'hono'
import type * as v from 'valibot'
import { jsonError } from '../util/http'
import { formatValibotIssues } from '../util/valibot'

/**
 * Error hook for `vValidator`. Replaces valibot's default issue array with the
 * `{ error: string }` shape every other endpoint returns, which is what
 * `client/src/util/api_error.ts` reads.
 */
export function onValidationError<T extends v.GenericSchema>(
	result: v.SafeParseResult<T>,
	c: Context,
): Response | undefined {
	if (result.success) {
		return undefined
	}

	return jsonError(c, formatValibotIssues(result.issues), 400)
}
