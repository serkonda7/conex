import { Result } from 'better-result'
import type { Context } from 'hono'
import { type AuditRecord, recordAudit } from '../db/audit'
import { forwarded_for, peer_ip } from './client_ip'

/**
 * Appends an audit log entry with the request's source address. A failed
 * write is logged but never changes the request outcome. Pass `ip` when it
 * was read earlier: Bun forgets the peer once the client disconnects.
 */
export async function auditRequest(
	c: Context,
	entry: Pick<AuditRecord, 'event' | 'username' | 'user_id' | 'target_username'>,
	ip: string = peer_ip(c),
): Promise<void> {
	const res = await recordAudit({
		...entry,
		ip,
		forwarded_for: forwarded_for(c),
		user_agent: c.req.header('user-agent') ?? null,
	})
	if (Result.isError(res)) {
		console.error('Failed to write audit log entry:', res.error)
	}
}
