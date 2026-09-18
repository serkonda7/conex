import { eq, lt } from 'drizzle-orm'
import type { Context } from 'hono'
import { getConfig } from './config'
import { getDb } from './db'
import type { JwtPayload } from './middleware/auth'
import { access_log, sessions, users } from './schema'
import { nowSeconds } from './util/time'

export type AuditAction = 'login.success' | 'login.failure'

export function createAuditLog(params: {
	userId: string
	userEmail: string
	action: string
	resourceId?: string | null
	createdAt?: number
}): void {
	try {
		getDb()
			.insert(access_log)
			.values({
				id: Bun.randomUUIDv7(),
				user_id: params.userId,
				user_email: params.userEmail,
				action: params.action,
				resource_id: params.resourceId ?? null,
				created_at: params.createdAt ?? nowSeconds(),
			})
			.run()
	} catch {
		// Audit must never break the main request
	}
}

/**
 * Logs an authenticated action. Called explicitly from route handlers so
 * the audited action is obvious at the call site.
 *
 * Resolves `user_id` via the session record (most reliable) falling back to
 * a lookup by email. Never throws.
 */
export function logAccess(c: Context, action: AuditAction | string, resourceId?: string): void {
	try {
		const payload = c.get('jwtPayload') as JwtPayload | undefined
		if (!payload) {
			return
		}
		const email = payload.sub ?? 'unknown'
		let userId: string | undefined

		// Primary: session -> user_id (survives email changes)
		try {
			const sess = getDb().select().from(sessions).where(eq(sessions.id, payload.jti)).get()
			if (sess) {
				userId = sess.user_id
			}
		} catch {
			// ignore
		}

		if (!userId) {
			try {
				const user = getDb().select().from(users).where(eq(users.email, email)).get()
				if (user) {
					userId = user.id
				}
			} catch {
				// ignore
			}
		}

		if (!userId) {
			userId = email || 'unknown'
		}

		createAuditLog({ userId, userEmail: email, action, resourceId })
	} catch {
		// swallow
	}
}

/**
 * Logs login attempts (both success and failure). Unlike `logAccess`,
 * this does not require an authenticated context — it records the attempted
 * email address.
 */
export function logLoginAttempt(params: {
	email: string
	action: 'login.success' | 'login.failure'
	userId?: string | null
}): void {
	const email = params.email || 'unknown'
	const userId = params.userId || email || 'unknown'
	createAuditLog({ userId, userEmail: email, action: params.action })
}

/** Returns the configured retention in seconds (default 90 days). */
function getRetentionCutoffSeconds(now: number): number {
	let retentionDays = 90
	try {
		const cfg = getConfig()
		if (
			cfg.audit?.retentionDays &&
			Number.isInteger(cfg.audit.retentionDays) &&
			cfg.audit.retentionDays >= 1
		) {
			retentionDays = cfg.audit.retentionDays
		}
	} catch {
		retentionDays = 90
	}
	return now - retentionDays * 86400
}

/**
 * Deletes `access_log` rows older than the configured retention.
 * Returns number of rows removed. Never throws.
 */
export function pruneExpiredAuditLogs(now = nowSeconds()): number {
	try {
		const cutoff = getRetentionCutoffSeconds(now)
		const deleted = getDb()
			.delete(access_log)
			.where(lt(access_log.created_at, cutoff))
			.returning({ id: access_log.id })
			.all()
		return deleted.length
	} catch {
		return 0
	}
}

export const AUDIT_SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000
