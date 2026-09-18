import { and, count, desc, eq, lt, type SQL, sql } from 'drizzle-orm'
import type { Context } from 'hono'
import type { AuditRow } from 'shared/src/schemas'
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

export interface AuditListParams {
	search: string
	page: number
	limit: number
}

/** LIKE pattern with `%`, `_` and `\` escaped so the search stays literal. */
function searchPattern(raw: string): string {
	return `%${raw.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')}%`
}

/**
 * Paginated audit log, newest first. `search` matches action, user email,
 * or resource id as a literal substring.
 */
export function listAuditLogs(params: AuditListParams): {
	items: AuditRow[]
	total: number
	page: number
	limit: number
} {
	const db = getDb()
	const pattern = searchPattern(params.search)
	const conditions: SQL[] = []
	if (params.search) {
		conditions.push(
			sql`(${access_log.action} LIKE ${pattern} ESCAPE '\\' OR ${access_log.user_email} LIKE ${pattern} ESCAPE '\\' OR ${access_log.resource_id} LIKE ${pattern} ESCAPE '\\')`,
		)
	}
	const where = conditions.length > 0 ? and(...conditions) : undefined
	const items = db
		.select({
			id: access_log.id,
			user_email: access_log.user_email,
			action: access_log.action,
			resource_id: access_log.resource_id,
			created_at: access_log.created_at,
		})
		.from(access_log)
		.where(where)
		.orderBy(desc(access_log.created_at))
		.limit(params.limit)
		.offset((params.page - 1) * params.limit)
		.all()
	const totalRow = db.select({ n: count() }).from(access_log).where(where).get()
	return { items, total: totalRow?.n ?? 0, page: params.page, limit: params.limit }
}
