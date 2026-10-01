import { Result } from 'better-result'
import { and, desc, eq, lte } from 'drizzle-orm'
import type { AuditEvent, AuditLogEntryJson } from 'shared/src/schemas'
import { audit_log } from '../schema'
import { nowSeconds } from '../util/time'
import { getDb } from './connection'
import { type ListParams, type Page, pageRows, searchCondition, tryWrite } from './list'

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

export async function recordAudit(entry: AuditRecord): Promise<Result<unknown, Error>> {
	return tryWrite(() =>
		getDb()
			.insert(audit_log)
			.values({
				created_at: nowSeconds(),
				event: entry.event,
				username: clip(entry.username) ?? '',
				user_id: entry.user_id,
				ip: clip(entry.ip) ?? 'unknown',
				forwarded_for: clip(entry.forwarded_for),
				user_agent: clip(entry.user_agent),
			}),
	)
}

export interface AuditListParams extends ListParams {
	event?: AuditEvent
}

export async function listAuditLog(
	params: AuditListParams,
): Promise<Result<Page<AuditLogEntryJson>, Error>> {
	const where = and(
		searchCondition(params.search, [audit_log.username, audit_log.ip, audit_log.forwarded_for]),
		params.event ? eq(audit_log.event, params.event) : undefined,
	)
	const page = await pageRows(
		audit_log,
		where,
		[desc(audit_log.created_at), desc(audit_log.id)],
		params,
	)
	return Result.ok(page as Page<AuditLogEntryJson>)
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
