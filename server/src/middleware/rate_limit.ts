import type { Context, MiddlewareHandler, Next } from 'hono'
import { requestUser } from '../authz'
import { getConfig } from '../config'
import { client_ip } from '../util/client_ip'
import { jsonError } from '../util/http'

/**
 * Fixed-window rate limiters: login attempts by client IP, public
 * endpoints by IP, expensive calls by user.
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

export function rate_limit(): MiddlewareHandler {
	return async (c: Context, next: Next): Promise<Response | undefined> => {
		const { maxAttempts, windowSeconds } = getConfig().auth.loginRateLimit

		// Millisecond clock by design: the fixed window needs sub-second
		// precision for Retry-After; nowSeconds() (integer seconds) is the
		// canonical clock everywhere else server-side.
		const now = Date.now()
		const ip = client_ip(c)

		const bucket = bucketFor(buckets, ip, windowSeconds, now)
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

/** The live bucket of `key`, opening a new window when the last one ended. */
function bucketFor(
	map: Map<string, Bucket>,
	key: string,
	windowSeconds: number,
	now: number,
): Bucket {
	let bucket = map.get(key)
	if (!bucket || bucket.resetAt <= now) {
		while (map.size >= MAX_BUCKETS) {
			const oldest = map.keys().next().value
			if (oldest === undefined) {
				break
			}
			map.delete(oldest)
		}
		bucket = { count: 0, resetAt: now + windowSeconds * 1000 }
		map.set(key, bucket)
	}
	return bucket
}

/**
 * Fixed-window limiter with its own buckets, keyed by `key(c)`; every
 * request counts. `limits` is read per request, so config changes apply.
 */
function keyed_rate_limit(
	key: (c: Context) => string,
	limits: () => { maxRequests: number; windowSeconds: number },
): MiddlewareHandler {
	const own = new Map<string, Bucket>()
	return async (c: Context, next: Next): Promise<Response | undefined> => {
		const { maxRequests, windowSeconds } = limits()
		const now = Date.now()
		const bucket = bucketFor(own, key(c), windowSeconds, now)
		bucket.count++
		if (bucket.count > maxRequests) {
			return jsonError(c, 'Too many requests', 429, {
				'Retry-After': String(Math.ceil((bucket.resetAt - now) / 1000)),
			})
		}
		await next()
	}
}

/**
 * Fixed-window limiter for public endpoints, keyed by client IP, with its
 * own buckets (independent of the login limiter). Every request counts.
 */
export function ip_rate_limit(maxRequests: number, windowSeconds: number): MiddlewareHandler {
	return keyed_rate_limit(client_ip, () => ({ maxRequests, windowSeconds }))
}

/** Fixed-window limiter keyed by the signed-in user; mount after `authMiddleware`. */
export function user_rate_limit(
	limits: () => { maxRequests: number; windowSeconds: number },
): MiddlewareHandler {
	return keyed_rate_limit((c) => String(requestUser(c).id), limits)
}
