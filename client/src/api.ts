/** Hono RPC client and typed API helpers for server communication. */
import { Result } from 'better-result'
import { hc } from 'hono/client'
import type { AppType } from 'server/src/index'
import type { HealthInfo } from 'shared/src/types'
import { type ApiResponse, read_api_error } from './util/api_error'

/** RPC client */
export const client = hc<AppType>('/api')

/** Signals that the server rejected a request because the session is gone. */
export class UnauthorizedError extends Error {
	constructor() {
		super('Not signed in')
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

/** Fetches the server health status (P0 scaffold smoke check). */
export async function fetch_health(): Promise<Result<HealthInfo, Error>> {
	const res = await client.health.$get()
	return to_result<HealthInfo>(res, 'Failed to load server health')
}
