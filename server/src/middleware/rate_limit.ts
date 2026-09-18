import type { Context, MiddlewareHandler, Next } from 'hono'
import { getConfig } from '../config'
import { jsonError } from '../util/http'

/**
 * Fixed-window login rate limiter keyed by client IP.
 *
 * In-memory by design: unlike sessions, losing counters on restart is a minor
 * availability-favouring failure, not a correctness bug. Note that this is per
 * instance — if multi-instance deployments are ever actually used, counters
 * become independent per instance.
 */

/** Cap on tracked IPs: a client-supplied XFF entry can spray fake keys, and "evict on read" never evicts keys nobody re-reads. */
const MAX_BUCKETS = 10_000

type Bucket = { count: number; resetAt: number }
const buckets = new Map<string, Bucket>()

/**
 * Direct connections only — no trusted reverse proxy sits in front of the
 * server, so `x-forwarded-for` is client-controlled and used purely as a
 * best-effort hint. Take the first header entry and fall back to the socket
 * address.
 */
function client_ip(c: Context): string {
	const xff = c.req.header('x-forwarded-for')
	if (xff) {
		return xff.split(',')[0].trim()
	}
	const ip = (c.req.raw as Request & { ip?: string }).ip
	return ip || 'unknown'
}

/** Test helper: clears all counters. */
export function reset_rate_limits(): void {
	buckets.clear()
}

export function rate_limit(): MiddlewareHandler {
	return async (c: Context, next: Next): Promise<Response | undefined> => {
		const { maxAttempts, windowSeconds } = getConfig().auth.loginRateLimit

		// Millisecond clock by design: the fixed window needs sub-second
		// precision for Retry-After; nowSeconds() (integer seconds) is the
		// canonical clock everywhere else server-side.
		const now = Date.now()
		const ip = client_ip(c)

		let bucket = buckets.get(ip)
		if (!bucket || bucket.resetAt <= now) {
			while (buckets.size >= MAX_BUCKETS) {
				const oldest = buckets.keys().next().value
				if (oldest === undefined) {
					break
				}
				buckets.delete(oldest)
			}
			bucket = { count: 0, resetAt: now + windowSeconds * 1000 }
			buckets.set(ip, bucket)
		}
		bucket.count++

		if (bucket.count > maxAttempts) {
			return jsonError(c, 'Too many requests', 429, {
				'Retry-After': String(Math.ceil((bucket.resetAt - now) / 1000)),
			})
		}

		await next()

		// Reset the counter on success, so one user's typo streak cannot lock out
		// a shared office NAT for the full window.
		if (c.res.status < 400) {
			buckets.delete(ip)
		}
	}
}
