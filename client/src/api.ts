/** Hono RPC client and typed API helpers for server communication. */
import { Result } from 'better-result'
import { hc } from 'hono/client'
import type { AppType } from 'server/src/index'
import type { HealthInfo, Page } from 'shared/src/types'
import { t } from './i18n'
import { type ApiResponse, read_api_error } from './util/api_error'

/** RPC client */
export const client = hc<AppType>('/api')

/** Signals that the server rejected a request because the session is gone. */
export class UnauthorizedError extends Error {
	constructor() {
		super(t('api.notSignedIn'))
		this.name = 'UnauthorizedError'
	}
}

/** Notified on every 401, so the UI can return to the login page. */
let unauthorized_handler: (() => void) | null = null

/**
 * Registers the callback for rejected requests. A 401 can happen at any time
 * because sessions time out, so this is handled centrally instead of per call.
 */
export function set_unauthorized_handler(handler: () => void): void {
	unauthorized_handler = handler
}

/**
 * Wraps a fetch response in a Result: reads a typed API error on failure,
 * otherwise returns the parsed JSON body typed as `T`. Chain `.map()` on the
 * result to project a single field.
 *
 * Exported so non-RPC call sites (raw fetches) read errors through the same
 * path: uniform `{ error }` parsing plus 401 handling.
 */
export async function to_result<T>(res: ApiResponse, fallback: string): Promise<Result<T, Error>> {
	if (res.status === 401) {
		unauthorized_handler?.()
		return Result.err(new UnauthorizedError())
	}

	if (!res.ok) {
		const msg = await read_api_error(res, `${fallback} (${res.status})`)
		return Result.err(new Error(msg))
	}

	return Result.ok((await res.json()) as T)
}

/** Query-string value before coercion: strings pass through, numbers/booleans stringify, `undefined` omits the param. */
export type QueryValue = string | number | boolean | undefined

/**
 * Coerces one query value to its string form, preserving string literals
 * (sort/order enums) so the generated RPC client types still check while
 * numbers/booleans become `String(v)`.
 */
export type CoercedQueryValue<V> = undefined extends V
	? Exclude<V, undefined> extends string
		? V
		: string | undefined
	: V extends string
		? V
		: string

/**
 * Builds the string map the hono RPC client expects from raw filter values.
 * Replaces the per-call `String(filters.x ?? ...)` boilerplate in every list
 * function: pass numbers/booleans directly, `undefined` stays `undefined` so
 * the param is omitted.
 */
export function to_query<T extends Record<string, QueryValue>>(
	query: T,
): {
	[K in keyof T]: CoercedQueryValue<T[K]>
} {
	const out: Record<string, string | undefined> = {}
	for (const [key, value] of Object.entries(query)) {
		out[key] = value === undefined ? undefined : String(value)
	}
	return out as { [K in keyof T]: CoercedQueryValue<T[K]> }
}

/**
 * Awaits a paginated RPC request and wraps the `Page<T>` body in a Result.
 * Single shared helper so the `api_p*` modules don't copy-paste the same
 * 3-line `to_result<Page<...>>` call.
 */
export async function getPage<T>(
	req: Promise<ApiResponse>,
	fallback: string,
): Promise<Result<Page<T>, Error>> {
	return to_result<Page<T>>(await req, fallback)
}

/**
 * POSTs a JSON body via raw `fetch` and wraps the JSON response in a Result.
 * Single shared helper for the non-RPC call sites (`api_auth`, `api_transfer`)
 * so `{ error }` parsing, 401 handling, and network-error mapping exist once.
 * Chain `.map()` to discard the body for void endpoints (login/setup).
 */
export async function post_json<T>(
	url: string,
	body: unknown,
	fallback: string,
	network_fallback?: string,
): Promise<Result<T, Error>> {
	try {
		const res = await fetch(url, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body),
		})
		return to_result<T>(res, fallback)
	} catch {
		return Result.err(new Error(network_fallback ?? fallback))
	}
}

/** Fetches the server health status (P0 scaffold smoke check). */
export async function fetch_health(): Promise<Result<HealthInfo, Error>> {
	const res = await client.health.$get()
	return to_result<HealthInfo>(res, t('api.loadHealthFailed'))
}
