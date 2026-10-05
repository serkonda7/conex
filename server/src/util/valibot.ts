/**
 * Shared valibot issue formatting.
 *
 * Single implementation for request validators (`middleware/validation.ts`)
 * and config loading (`config.ts`), which previously joined the same issues
 * with divergent path logic.
 */
import * as v from 'valibot'

/**
 * Turns a single valibot issue into a message a caller can act on.
 * The default texts for a missing or unexpected key read like internals
 * ("Invalid key: Expected never but received ..."), so those two get a
 * dedicated wording.
 */
export function formatValibotIssue(issue: v.BaseIssue<unknown>): string {
	const path = v.getDotPath(issue)
	if (!path) {
		return issue.message
	}

	if (issue.kind === 'schema' && issue.received === 'undefined') {
		return `Field "${path}" is required`
	}
	if (issue.type === 'strict_object') {
		return `Field "${path}" is not allowed`
	}

	return `${path}: ${issue.message}`
}

/** Joins all issues of a rejected payload into one sentence. */
export function formatValibotIssues(
	issues: readonly [v.BaseIssue<unknown>, ...v.BaseIssue<unknown>[]],
): string {
	return issues.map(formatValibotIssue).join('; ')
}
