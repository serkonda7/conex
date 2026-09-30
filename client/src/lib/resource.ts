/**
 * `createResource` wrappers for the API's `Result` returns. Every page used
 * to repeat the same unwrap: report a failure to the page's error line and
 * fall back to an empty value, so the rest of the page stays usable.
 */
import { Result } from 'better-result'
import { createResource, type ResourceReturn } from 'solid-js'

/** Receives the message of a failed request (usually a page's `setError`). */
export type ErrorSink = (message: string) => void

/** The value of `res`, or `fallback` after reporting the error to `onError`. */
export function unwrap<T, F>(res: Result<T, Error>, fallback: F, onError?: ErrorSink): T | F {
	if (Result.isError(res)) {
		onError?.(res.error.message)
		return fallback
	}
	return res.value
}

/** List endpoints answer with a page (`{ items }`) or a plain array. */
type Rows<T> = { items: T[] } | T[]

function items<T>(rows: Rows<T>): T[] {
	return Array.isArray(rows) ? rows : rows.items
}

/** Rows of a list endpoint; a failed fetch reports to `onError` and yields `[]`. */
export function createRows<T>(
	load: () => Promise<Result<Rows<T>, Error>>,
	onError?: ErrorSink,
): ResourceReturn<T[]> {
	return createResource(async (): Promise<T[]> => items(unwrap(await load(), [], onError)))
}

/**
 * Rows refetched whenever `source` changes. Like any source-driven
 * resource, nothing loads while the source is `null`, `undefined` or `false`.
 */
export function createRowsFor<S, T>(
	source: () => S | null | undefined | false,
	load: (value: S) => Promise<Result<Rows<T>, Error>>,
	onError?: ErrorSink,
): ResourceReturn<T[]> {
	return createResource(
		source,
		async (value: S): Promise<T[]> => items(unwrap(await load(value), [], onError)),
	)
}

/**
 * One record for the id (or other key) in `source`; a failed fetch reports
 * to `onError` and yields `null`. A missing key (e.g. a nullable foreign
 * key) loads nothing.
 */
export function createRecord<S, T>(
	source: () => S | null | undefined | false,
	load: (value: S) => Promise<Result<T, Error>>,
	onError?: ErrorSink,
): ResourceReturn<T | null> {
	return createResource(
		source,
		async (value: S): Promise<T | null> => unwrap(await load(value), null, onError),
	)
}
