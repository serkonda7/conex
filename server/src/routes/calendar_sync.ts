import { vValidator } from '@hono/valibot-validator'
import { Result } from 'better-result'
import { type Context, Hono } from 'hono'
import {
	type AuditEvent,
	CalendarMappingParamsSchema,
	CalendarMappingSchema,
	CalendarSyncConfigSchema,
	CalendarSyncTestSchema,
	type CalendarTechnicianJson,
} from 'shared/src/schemas'
import { requestUser, requireGlobalScope } from '../authz'
import { startCalendarSync, tanssSession } from '../calendar_sync/run'
import {
	deleteMapping,
	getCalendarSyncConfig,
	listMappings,
	listRuns,
	mappingJson,
	saveCalendarSyncConfig,
	saveMapping,
	testCalendarSyncConfig,
} from '../calendar_sync/store'
import { ExternalServiceError } from '../db/errors'
import { authMiddleware } from '../middleware/auth'
import { requirePermissionMiddleware } from '../middleware/permissions'
import { onValidationError } from '../middleware/validation'
import { auditRequest } from '../util/audit'
import { sendResult } from '../util/result_response'

/** Audit entry for a successful change by the requesting user. */
async function audit(c: Context, event: AuditEvent, target: string | null = null): Promise<void> {
	const actor = requestUser(c)
	await auditRequest(c, {
		event,
		username: actor.username,
		user_id: actor.id,
		target_username: target,
	})
}

/** TANSS technicians with their mapping; mappings of vanished technicians are kept. */
async function technicians(): Promise<Result<CalendarTechnicianJson[], Error>> {
	const tanss = await tanssSession()
	if (Result.isError(tanss)) {
		return tanss
	}
	const listed = await tanss.value.session.listTechnicians()
	if (Result.isError(listed)) {
		return Result.err(new ExternalServiceError(listed.error.message))
	}
	const mappings = new Map((await listMappings()).map((m) => [m.tanss_employee_id, m]))
	const rows: CalendarTechnicianJson[] = listed.value.map((tech) => {
		const mapping = mappings.get(tech.id)
		mappings.delete(tech.id)
		return {
			tanss_employee_id: tech.id,
			name: tech.name,
			email: tech.email,
			mapping: mapping ? mappingJson(mapping) : null,
		}
	})
	for (const mapping of mappings.values()) {
		rows.push({
			tanss_employee_id: mapping.tanss_employee_id,
			name: `#${mapping.tanss_employee_id}`,
			email: null,
			mapping: mappingJson(mapping),
		})
	}
	return Result.ok(rows.sort((a, b) => a.name.localeCompare(b.name)))
}

/**
 * Calendar sync (TANSS appointments → Outlook): settings, technician →
 * mailbox mappings and runs. Global `integrations.manage` only: the sync
 * writes to mailboxes of the whole organisation. Changes are audited.
 */
export const calendarSyncApp = new Hono()
	.use(authMiddleware)
	.use(requirePermissionMiddleware('integrations.manage'))
	.use(async (c, next) => {
		const denied = requireGlobalScope(c, 'Forbidden: the calendar sync is global')
		if (denied) {
			return denied
		}
		await next()
	})
	.get('/config', async (c) => c.json(await getCalendarSyncConfig()))
	.put('/config', vValidator('json', CalendarSyncConfigSchema, onValidationError), async (c) => {
		const res = await saveCalendarSyncConfig(c.req.valid('json'))
		if (Result.isOk(res)) {
			await audit(c, 'calendar_sync.config_update')
		}
		return sendResult(c, res)
	})
	.post(
		'/config/test',
		vValidator('json', CalendarSyncTestSchema, onValidationError),
		async (c) => {
			const res = await testCalendarSyncConfig(c.req.valid('json'))
			return sendResult(
				c,
				res.map(() => ({ ok: true })),
			)
		},
	)
	.get('/technicians', async (c) => sendResult(c, await technicians()))
	.put(
		'/mappings/:tanssEmployeeId',
		vValidator('param', CalendarMappingParamsSchema, onValidationError),
		vValidator('json', CalendarMappingSchema, onValidationError),
		async (c) => {
			const res = await saveMapping(
				c.req.valid('param').tanssEmployeeId,
				c.req.valid('json'),
				requestUser(c).id,
			)
			if (Result.isOk(res)) {
				await audit(c, 'calendar_sync.mapping_update', res.value.mailbox_upn)
			}
			return sendResult(c, res)
		},
	)
	.delete(
		'/mappings/:tanssEmployeeId',
		vValidator('param', CalendarMappingParamsSchema, onValidationError),
		async (c) => {
			const res = await deleteMapping(c.req.valid('param').tanssEmployeeId)
			if (Result.isOk(res)) {
				await audit(c, 'calendar_sync.mapping_delete', res.value.mailbox_upn)
			}
			return sendResult(c, res)
		},
	)
	.post('/run', async (c) => {
		const res = await startCalendarSync()
		if (Result.isOk(res)) {
			await audit(c, 'calendar_sync.run')
		}
		return sendResult(c, res, 202)
	})
	.get('/runs', async (c) => c.json(await listRuns()))
