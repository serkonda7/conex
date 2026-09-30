/**
 * Hono RPC client plus the helpers every `api/*` module shares: Result
 * wrapping with central 401 handling, query coercion, and the localized
 * fallback messages for failed requests.
 */
import { Result } from 'better-result'
import { hc } from 'hono/client'
import type { AppType } from 'server/src/index'
import type { Page } from 'shared/src/types'
import { type PluralKey, t, tp } from '../i18n'

/** RPC client */
export const client = hc<AppType>('/api')

export type ApiResponse = Pick<Response, 'ok' | 'status' | 'json'>

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

/** The server's `{ error }` message, or `fallback_msg` when the body has none. */
export async function read_api_error(response: ApiResponse, fallback_msg: string): Promise<string> {
	const data = await response.json().catch(() => null)
	if (typeof data === 'object' && data && 'error' in data) {
		return String((data as { error: unknown }).error)
	}
	return fallback_msg
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

/** Awaits a paginated RPC request and wraps the `Page<T>` body in a Result. */
export async function getPage<T>(
	req: Promise<ApiResponse>,
	fallback: string,
): Promise<Result<Page<T>, Error>> {
	return to_result<Page<T>>(await req, fallback)
}

/**
 * POSTs a JSON body via raw `fetch` and wraps the JSON response in a Result,
 * for the non-RPC call sites (`auth`, `transfer`). Chain `.map()` to discard
 * the body for void endpoints (login/setup).
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
 * Builds the string map the hono RPC client expects from raw filter values:
 * pass numbers/booleans directly, `undefined` stays `undefined` so the param
 * is omitted.
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

/** Search and paging defaults of every list endpoint (the UI shows up to 200 rows). */
export function paging(filters?: { search?: string; page?: number; limit?: number }): {
	search: string
	page: number
	limit: number
} {
	return {
		search: filters?.search ?? '',
		page: filters?.page ?? 1,
		limit: filters?.limit ?? 200,
	}
}

/** `:id` route param of the RPC client. */
export function by_id(id: number): { param: { id: string } } {
	return { param: { id: String(id) } }
}

/** Localized fallback messages for failed CRUD requests on `noun`. */
export const failed = {
	list: (noun: PluralKey): string => tp('api.loadFailed', 2, { noun: tp(noun, 2) }),
	load: (noun: PluralKey): string => tp('api.loadFailed', 1, { noun: tp(noun, 1) }),
	create: (noun: PluralKey): string => t('api.createFailed', { noun: tp(noun, 1) }),
	update: (noun: PluralKey): string => t('api.updateFailed', { noun: tp(noun, 1) }),
	delete: (noun: PluralKey): string => t('api.deleteFailed', { noun: tp(noun, 1) }),
}
