/**
 * Audit log API wrapper: admin-only, read-only list of security events
 * (login attempts), newest first.
 */
import type { Result } from 'better-result'
import type { AuditLogEntryJson, AuditLogListQuery, Page } from 'shared/src/types'
import { client, failed, getPage, paging, to_query } from './client'

export type { AuditLogEntryJson }

export async function fetch_audit_log(
	filters?: Partial<AuditLogListQuery>,
): Promise<Result<Page<AuditLogEntryJson>, Error>> {
	return getPage<AuditLogEntryJson>(
		client['audit-log'].$get({
			query: to_query({ ...paging(filters), event: filters?.event }),
		}),
		failed.list('noun.auditEntry'),
	)
}
