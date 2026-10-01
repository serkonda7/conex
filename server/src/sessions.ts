import { eq, lte, or } from 'drizzle-orm'
import { sign } from 'hono/jwt'
import type { CookieOptions } from 'hono/utils/cookie'
import { SESSION_ABSOLUTE_TIMEOUT_S, SESSION_IDLE_TIMEOUT_S } from 'shared/src/session'
import { getConfig } from './config'
import { getDb } from './db'
import { pruneAuditLog } from './db/audit'
import { getSigningKey } from './keys'
import { JWT_ALGO, type JwtPayload } from './middleware/auth'
import { auth_states, sessions } from './schema'
import type { User } from './types'
import { nowSeconds } from './util/time'

export function getSessionCookieOpts(): CookieOptions {
	return {
		httpOnly: true,
		secure: getConfig().auth.secureCookies,
		sameSite: 'Strict',
		path: '/',
		maxAge: SESSION_ABSOLUTE_TIMEOUT_S,
	}
}

/**
 * Cookie options for the short-lived OAuth state cookie. Shares the secure
 * flag with the session cookie; SameSite=Lax (not Strict) so the browser
 * sends it back on the top-level redirect from the identity provider.
 * Deletions must mirror these flags or the cookie survives logout.
 */
export function getStateCookieOpts(maxAgeSeconds: number): CookieOptions {
	return {
		httpOnly: true,
		secure: getConfig().auth.secureCookies,
		sameSite: 'Lax',
		path: '/',
		maxAge: maxAgeSeconds,
	}
}

export const SESSION_SWEEP_INTERVAL_MS = 60 * 60 * 1000

export async function createSession(userId: number): Promise<string> {
	// Opaque v7 token (not an entity id): time-ordered, so recent sessions
	// sort without a secondary index.
	const id = Bun.randomUUIDv7()
	const now = nowSeconds()
	await getDb()
		.insert(sessions)
		.values({
			id,
			user_id: userId,
			created_at: now,
			last_seen_at: now,
			expires_at: now + SESSION_ABSOLUTE_TIMEOUT_S,
		})
	return id
}

export async function isValidSession(sid: string): Promise<boolean> {
	const session = (await getDb().select().from(sessions).where(eq(sessions.id, sid)).limit(1))[0]
	if (!session) {
		return false
	}

	const now = nowSeconds()
	if (session.expires_at <= now || session.last_seen_at + SESSION_IDLE_TIMEOUT_S <= now) {
		await getDb().delete(sessions).where(eq(sessions.id, sid))
		return false
	}
	return true
}

/**
 * Validates the session and refreshes its idle window in a single query round
 * trip. Returns false when the session is missing or expired (expired rows are
 * removed as a side effect). Callers must not check `isValidSession()` first —
 * that would query the same row twice per request.
 */
export async function touchSession(sid: string): Promise<boolean> {
	if (!(await isValidSession(sid))) {
		return false
	}
	await getDb().update(sessions).set({ last_seen_at: nowSeconds() }).where(eq(sessions.id, sid))
	return true
}

export async function invalidateSession(sid: string): Promise<void> {
	await getDb().delete(sessions).where(eq(sessions.id, sid))
}

/**
 * Removes expired sessions and PKCE states in one scheduled sweep, plus
 * audit log entries past their retention.
 */
export async function sweepExpired(): Promise<number> {
	const now = nowSeconds()
	const expiredSessions = or(
		lte(sessions.expires_at, now),
		lte(sessions.last_seen_at, now - SESSION_IDLE_TIMEOUT_S),
	)
	const removed = await getDb().transaction(async (tx) => {
		const sessionsRemoved = (
			await tx.delete(sessions).where(expiredSessions).returning({ id: sessions.id })
		).length
		const statesRemoved = (
			await tx
				.delete(auth_states)
				.where(lte(auth_states.expires_at, now))
				.returning({ state: auth_states.state })
		).length
		return sessionsRemoved + statesRemoved
	})
	const auditRemoved = await pruneAuditLog(now)
	return removed + auditRemoved
}

export async function get_signed_jwt(user: User): Promise<string> {
	const now = nowSeconds()
	const sid = await createSession(user.id)
	const payload: JwtPayload = {
		sub: user.username,
		jti: sid,
		iat: now,
		exp: now + SESSION_ABSOLUTE_TIMEOUT_S,
	}
	return await sign(payload, getSigningKey(), JWT_ALGO)
}
