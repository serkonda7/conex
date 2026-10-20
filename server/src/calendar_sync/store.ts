/**
 * Calendar sync state: the single settings row (Graph client secret
 * encrypted with the integration key), technician → mailbox mappings, the
 * synced items and the run history.
 */
import { Result } from 'better-result'
import { desc, eq, inArray } from 'drizzle-orm'
import type {
	CalendarMapping,
	CalendarMappingJson,
	CalendarSyncConfig,
	CalendarSyncConfigJson,
	CalendarSyncRunCounts,
	CalendarSyncRunJson,
	CalendarSyncTest,
} from 'shared/src/schemas'
import * as v from 'valibot'
import { getDb } from '../db/connection'
import { NotFoundError, ValidationError } from '../db/errors'
import { errOf, tryWrite } from '../db/list'
import { decryptJson, encryptJson } from '../integrations/secrets'
import {
	calendar_sync_config,
	calendar_sync_items,
	calendar_sync_mappings,
	calendar_sync_runs,
} from '../schema'
import { nowSeconds } from '../util/time'
import { GraphClient, type GraphCredentials } from './graph'

export type ConfigRow = typeof calendar_sync_config.$inferSelect
export type MappingRow = typeof calendar_sync_mappings.$inferSelect
export type ItemRow = typeof calendar_sync_items.$inferSelect
export type RunRow = typeof calendar_sync_runs.$inferSelect

const CONFIG_ID = 1

const SecretSchema = v.object({ client_secret: v.string() })

const CountsSchema = v.object({
	created: v.optional(v.number(), 0),
	updated: v.optional(v.number(), 0),
	deleted: v.optional(v.number(), 0),
	failed: v.optional(v.number(), 0),
})

export const EMPTY_COUNTS: CalendarSyncRunCounts = { created: 0, updated: 0, deleted: 0, failed: 0 }

export function runJson(row: RunRow): CalendarSyncRunJson {
	const counts = v.safeParse(CountsSchema, row.counts ?? {})
	return {
		id: row.id,
		started_at: row.started_at,
		finished_at: row.finished_at,
		state: row.state as CalendarSyncRunJson['state'],
		error: row.error,
		counts: counts.success ? counts.output : { ...EMPTY_COUNTS },
	}
}

export async function lastRun(): Promise<RunRow | null> {
	const row = (
		await getDb()
			.select()
			.from(calendar_sync_runs)
			.orderBy(desc(calendar_sync_runs.started_at), desc(calendar_sync_runs.id))
			.limit(1)
	)[0]
	return row ?? null
}

export async function listRuns(limit = 20): Promise<CalendarSyncRunJson[]> {
	const rows = await getDb()
		.select()
		.from(calendar_sync_runs)
		.orderBy(desc(calendar_sync_runs.started_at), desc(calendar_sync_runs.id))
		.limit(limit)
	return rows.map(runJson)
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export async function getConfigRow(): Promise<ConfigRow | null> {
	const row = (
		await getDb()
			.select()
			.from(calendar_sync_config)
			.where(eq(calendar_sync_config.id, CONFIG_ID))
			.limit(1)
	)[0]
	return row ?? null
}

function storedSecret(row: ConfigRow | null): Result<string, Error> {
	if (!row) {
		return Result.ok('')
	}
	return decryptJson(row.secret, SecretSchema).map((s) => s.client_secret)
}

export async function getCalendarSyncConfig(): Promise<CalendarSyncConfigJson> {
	const row = await getConfigRow()
	const secret = storedSecret(row)
	const run = await lastRun()
	return {
		configured: row !== null,
		ms_tenant_id: row?.ms_tenant_id ?? '',
		client_id: row?.client_id ?? '',
		has_secret: Result.isOk(secret) && secret.value !== '',
		enabled: row?.enabled === 1,
		interval_minutes: row?.interval_minutes ?? 5,
		last_error: Result.isError(secret) ? secret.error.message : (row?.last_error ?? null),
		updated_at: row?.updated_at ?? null,
		last_run: run ? runJson(run) : null,
	}
}

/** Graph credentials of the saved settings. */
export async function storedCredentials(): Promise<Result<GraphCredentials, Error>> {
	const row = await getConfigRow()
	if (!row) {
		return Result.err(new NotFoundError('Calendar sync is not configured'))
	}
	const secret = storedSecret(row)
	if (Result.isError(secret)) {
		return secret
	}
	return Result.ok({
		ms_tenant_id: row.ms_tenant_id,
		client_id: row.client_id,
		client_secret: secret.value,
	})
}

/** Form values with the stored secret filled in when omitted. */
async function mergedCredentials(input: {
	ms_tenant_id: string
	client_id: string
	client_secret?: string
}): Promise<Result<GraphCredentials, Error>> {
	let secret = input.client_secret
	if (secret === undefined) {
		const stored = storedSecret(await getConfigRow())
		secret = Result.isOk(stored) ? stored.value : ''
	}
	if (secret === '') {
		return Result.err(new ValidationError('Client secret is required'))
	}
	return Result.ok({
		ms_tenant_id: input.ms_tenant_id,
		client_id: input.client_id,
		client_secret: secret,
	})
}

/** Token request (and optional calendar read); a refusal becomes a 422. */
async function verifyCredentials(
	creds: GraphCredentials,
	mailboxUpn?: string,
): Promise<Result<void, Error>> {
	const graph = new GraphClient(creds)
	const token = await graph.token()
	if (Result.isError(token)) {
		return Result.err(new ValidationError(token.error.message))
	}
	if (mailboxUpn !== undefined) {
		const calendar = await graph.verify(mailboxUpn)
		if (Result.isError(calendar)) {
			return Result.err(new ValidationError(calendar.error.message))
		}
	}
	return Result.ok(undefined)
}

/** "Test connection": verifies unsaved form values, nothing is stored. */
export async function testCalendarSyncConfig(
	input: CalendarSyncTest,
): Promise<Result<void, Error>> {
	const creds = await mergedCredentials(input)
	if (Result.isError(creds)) {
		return creds
	}
	return verifyCredentials(creds.value, input.mailbox_upn)
}

/** Creates or replaces the settings; changed credentials are verified first. */
export async function saveCalendarSyncConfig(
	input: CalendarSyncConfig,
): Promise<Result<CalendarSyncConfigJson, Error>> {
	const row = await getConfigRow()
	const creds = await mergedCredentials(input)
	if (Result.isError(creds)) {
		return creds
	}
	const credentialsChanged =
		row === null ||
		row.ms_tenant_id !== input.ms_tenant_id ||
		row.client_id !== input.client_id ||
		input.client_secret !== undefined
	if (credentialsChanged) {
		const ok = await verifyCredentials(creds.value)
		if (Result.isError(ok)) {
			return ok
		}
	}
	const now = nowSeconds()
	const values = {
		ms_tenant_id: input.ms_tenant_id,
		client_id: input.client_id,
		secret: encryptJson({ client_secret: creds.value.client_secret }),
		enabled: input.enabled ? 1 : 0,
		interval_minutes: input.interval_minutes,
		updated_at: now,
		...(credentialsChanged ? { last_error: null } : {}),
	}
	const saved = await tryWrite(() =>
		getDb()
			.insert(calendar_sync_config)
			.values({ id: CONFIG_ID, created_at: now, ...values })
			.onConflictDoUpdate({ target: calendar_sync_config.id, set: values }),
	)
	if (Result.isError(saved)) {
		return saved
	}
	return Result.ok(await getCalendarSyncConfig())
}

export async function recordConfigError(error: string | null): Promise<void> {
	await getDb()
		.update(calendar_sync_config)
		.set({ last_error: error })
		.where(eq(calendar_sync_config.id, CONFIG_ID))
}

// ---------------------------------------------------------------------------
// Mappings
// ---------------------------------------------------------------------------

export function mappingJson(row: MappingRow): CalendarMappingJson {
	return {
		tanss_employee_id: row.tanss_employee_id,
		mailbox_upn: row.mailbox_upn,
		enabled: row.enabled === 1,
		created_at: row.created_at,
	}
}

export async function listMappings(): Promise<MappingRow[]> {
	return getDb()
		.select()
		.from(calendar_sync_mappings)
		.orderBy(calendar_sync_mappings.tanss_employee_id)
}

export async function saveMapping(
	tanssEmployeeId: number,
	input: CalendarMapping,
	userId: number,
): Promise<Result<CalendarMappingJson, Error>> {
	const saved = await tryWrite(
		() =>
			getDb()
				.insert(calendar_sync_mappings)
				.values({
					tanss_employee_id: tanssEmployeeId,
					mailbox_upn: input.mailbox_upn,
					enabled: input.enabled ? 1 : 0,
					created_by: userId,
					created_at: nowSeconds(),
				})
				.onConflictDoUpdate({
					target: calendar_sync_mappings.tanss_employee_id,
					set: { mailbox_upn: input.mailbox_upn, enabled: input.enabled ? 1 : 0 },
				})
				.returning(),
		'This technician is already mapped',
	)
	if (Result.isError(saved)) {
		return saved
	}
	const row = saved.value[0]
	return row ? Result.ok(mappingJson(row)) : Result.err(new Error('Mapping save returned no row'))
}

/**
 * Removes a mapping. Its events stay in Outlook until the next run, which
 * deletes them (the items remember the mailbox).
 */
export async function deleteMapping(
	tanssEmployeeId: number,
): Promise<Result<CalendarMappingJson, Error>> {
	try {
		const row = (
			await getDb()
				.delete(calendar_sync_mappings)
				.where(eq(calendar_sync_mappings.tanss_employee_id, tanssEmployeeId))
				.returning()
		)[0]
		return row
			? Result.ok(mappingJson(row))
			: Result.err(new NotFoundError('Mapping not found'))
	} catch (e) {
		return Result.err(errOf(e))
	}
}

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

export async function listItems(): Promise<ItemRow[]> {
	return getDb().select().from(calendar_sync_items)
}

export async function upsertItem(item: ItemRow): Promise<void> {
	const { item_key: _key, ...rest } = item
	await getDb()
		.insert(calendar_sync_items)
		.values(item)
		.onConflictDoUpdate({ target: calendar_sync_items.item_key, set: rest })
}

export async function deleteItems(keys: string[]): Promise<void> {
	if (keys.length > 0) {
		await getDb().delete(calendar_sync_items).where(inArray(calendar_sync_items.item_key, keys))
	}
}

// ---------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------

export async function insertRun(): Promise<Result<RunRow, Error>> {
	const inserted = await tryWrite(() =>
		getDb()
			.insert(calendar_sync_runs)
			.values({ started_at: nowSeconds(), state: 'running' })
			.returning(),
	)
	if (Result.isError(inserted)) {
		return inserted
	}
	const row = inserted.value[0]
	return row ? Result.ok(row) : Result.err(new Error('Calendar sync run insert returned no row'))
}

export async function finishRun(
	id: number,
	counts: CalendarSyncRunCounts,
	error: string | null,
): Promise<void> {
	await getDb()
		.update(calendar_sync_runs)
		.set({ state: error === null ? 'ok' : 'error', finished_at: nowSeconds(), counts, error })
		.where(eq(calendar_sync_runs.id, id))
}

/** Marks runs interrupted by a restart as failed. Called once at startup. */
export async function failInterruptedCalendarSyncs(): Promise<void> {
	await getDb()
		.update(calendar_sync_runs)
		.set({ state: 'error', finished_at: nowSeconds(), error: 'Interrupted by server restart' })
		.where(eq(calendar_sync_runs.state, 'running'))
}
