import type { Context } from 'hono'
import { getConnInfo } from 'hono/bun'

/**
 * Socket peer address from Bun's server (passed as the 2nd `fetch`
 * argument). `'unknown'` when there is no server, e.g. `app.request()` in
 * tests.
 */
export function peer_ip(c: Context): string {
	try {
		return getConnInfo(c).remote.address ?? 'unknown'
	} catch {
		return 'unknown'
	}
}

/**
 * Raw `X-Forwarded-For` header, or `null`. No trusted reverse proxy sits in
 * front of the server, so this is client-controlled: a best-effort hint only.
 */
export function forwarded_for(c: Context): string | null {
	return c.req.header('x-forwarded-for')?.trim() || null
}

/** Best-effort client address: the first forwarded entry, else the socket peer. */
export function client_ip(c: Context): string {
	return forwarded_for(c)?.split(',')[0]?.trim() || peer_ip(c)
}
