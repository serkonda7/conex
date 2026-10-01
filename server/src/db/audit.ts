import { Result } from 'better-result'
import { and, count, desc, eq, lte, or, type SQL, sql } from 'drizzle-orm'
import type { AuditEvent, AuditLogEntryJson } from 'shared/src/schemas'
import { audit_log } from '../schema'
import { nowSeconds } from '../util/time'
import { getDb } from './connection'
import { errOf, type ListParams, offsetOf, type Page, pageOf, searchPattern } from './list'

/** Entries older than this are dropped by the periodic session sweep. */
export const AUDIT_RETENTION_S = 365 * 24 * 60 * 60

/** Caps on client-supplied text so a hostile request cannot bloat rows. */
const MAX_TEXT = 512

function clip(value: string | null): string | null {
	return value === null ? null : value.slice(0, MAX_TEXT)
}

export interface AuditRecord {
	event: AuditEvent
	username: string
	user_id: number | null
	ip: string
	forwarded_for: string | null
	user_agent: string | null
}

export async function recordAudit(entry: AuditRecord): Promise<Result<undefined, Error>> {
	try {
		await getDb()
			.insert(audit_log)
			.values({
				created_at: nowSeconds(),
				event: entry.event,
				username: clip(entry.username) ?? '',
				user_id: entry.user_id,
				ip: clip(entry.ip) ?? 'unknown',
				forwarded_for: clip(entry.forwarded_for),
				user_agent: clip(entry.user_agent),
			})
		return Result.ok(undefined)
	} catch (e) {
		return Result.err(errOf(e))
	}
}

export interface AuditListParams extends ListParams {
	event?: AuditEvent
}

export async function listAuditLog(
	params: AuditListParams,
): Promise<Result<Page<AuditLogEntryJson>, Error>> {
	const db = getDb()
	const conditions: SQL[] = []
	if (params.search) {
		const pattern = searchPattern(params.search)
		const match = or(
			sql`${audit_log.username} ILIKE ${pattern} ESCAPE '\\'`,
			sql`${audit_log.ip} ILIKE ${pattern} ESCAPE '\\'`,
			sql`${audit_log.forwarded_for} ILIKE ${pattern} ESCAPE '\\'`,
		)
		if (match) {
			conditions.push(match)
		}
	}
	if (params.event) {
		conditions.push(eq(audit_log.event, params.event))
	}
	const where = conditions.length > 0 ? and(...conditions) : undefined
	try {
		const rows = await db
			.select()
			.from(audit_log)
			.where(where)
			.orderBy(desc(audit_log.created_at), desc(audit_log.id))
			.limit(params.limit)
			.offset(offsetOf(params))
		const totalRow = (await db.select({ n: count() }).from(audit_log).where(where).limit(1))[0]
		return Result.ok(pageOf(rows as AuditLogEntryJson[], totalRow?.n ?? 0, params))
	} catch (e) {
		return Result.err(errOf(e))
	}
}

/** Drops entries past the retention window; returns the number removed. */
export async function pruneAuditLog(now: number): Promise<number> {
	return (
		await getDb()
			.delete(audit_log)
			.where(lte(audit_log.created_at, now - AUDIT_RETENTION_S))
			.returning({ id: audit_log.id })
	).length
}
