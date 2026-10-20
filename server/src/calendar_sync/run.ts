/**
 * Calendar sync runs: fetch the planned TANSS appointments of the mapped
 * technicians, diff them against `calendar_sync_items` and apply the
 * difference to the technicians' Outlook calendars.
 *
 * - new → create; content changed → update; moved to another mailbox
 *   (mapping changed, appointment reassigned) → delete there and create.
 * - gone from TANSS → delete, but only when it starts inside the current
 *   window. Items that age out of the window stay. A failed TANSS call
 *   deletes nothing.
 * - mapping removed → its events are deleted; mapping disabled → its
 *   events are left alone.
 * - an event the user deleted in Outlook (404 on update) is recreated.
 *
 * One run at a time (in-memory flag), tracked in `calendar_sync_runs`. A
 * failing item or mailbox is counted and reported, the others continue.
 */
import { Result } from 'better-result'
import type { CalendarSyncRunCounts, CalendarSyncRunJson } from 'shared/src/schemas'
import type { TnsPlanningType } from 'tanss-api'
import { ConflictError, NotFoundError } from '../db/errors'
import { errOf } from '../db/list'
import { decryptSecrets } from '../integrations/secrets'
import { getIntegrationRow } from '../integrations/store'
import { type TanssAppointments, TanssSession } from '../integrations/tanss/client'
import { nowSeconds } from '../util/time'
import { GraphClient, isGraphNotFound } from './graph'
import { type CalendarItem, hash, toCalendarItem, toGraphEvent } from './map'
import {
	deleteItems,
	EMPTY_COUNTS,
	finishRun,
	getConfigRow,
	type ItemRow,
	insertRun,
	lastRun,
	listItems,
	listMappings,
	type MappingRow,
	type RunRow,
	recordConfigError,
	runJson,
	storedCredentials,
	upsertItem,
} from './store'

/** Synced planning types; a setting for this comes after the MVP. */
const PLANNING_TYPES: TnsPlanningType[] = ['APPOINTMENT_FIX']

const DAY_S = 24 * 60 * 60
const WINDOW_PAST_DAYS = 7
const WINDOW_FUTURE_DAYS = 60

let running = false

export interface SyncWindow {
	from: number
	to: number
}

/** Today (UTC) −7 days up to the end of today +60 days. */
export function syncWindow(now: number): SyncWindow {
	const today = now - (now % DAY_S)
	return { from: today - WINDOW_PAST_DAYS * DAY_S, to: today + (WINDOW_FUTURE_DAYS + 1) * DAY_S }
}

/** Session of the TANSS integration (its stored user-API credentials). */
export async function tanssSession(): Promise<
	Result<{ session: TanssSession; baseUrl: string }, Error>
> {
	const row = await getIntegrationRow('tanss')
	if (Result.isError(row)) {
		return Result.err(new NotFoundError('The TANSS integration is not configured'))
	}
	if (row.value.enabled !== 1) {
		return Result.err(new ConflictError('The TANSS integration is disabled'))
	}
	const secrets = decryptSecrets(row.value.secrets)
	if (Result.isError(secrets)) {
		return secrets
	}
	return Result.ok({
		session: new TanssSession({
			base_url: row.value.base_url,
			username: row.value.username,
			...secrets.value,
		}),
		baseUrl: row.value.base_url,
	})
}

/**
 * Calendar items of the active technicians. TANSS may return a recurring
 * appointment as several entries with the same support id; those are keyed
 * by id and start.
 */
function normalize(
	appointments: TanssAppointments,
	baseUrl: string,
	techIds: Set<number>,
): CalendarItem[] {
	const supports = appointments.supports.filter(
		(s) =>
			s.employeeId !== undefined &&
			techIds.has(s.employeeId) &&
			(s.planningType === undefined || PLANNING_TYPES.includes(s.planningType)),
	)
	const occurrences = new Map<number, number>()
	for (const s of supports) {
		if (s.id !== undefined) {
			occurrences.set(s.id, (occurrences.get(s.id) ?? 0) + 1)
		}
	}
	const items = new Map<string, CalendarItem>()
	for (const s of supports) {
		const key =
			s.id !== undefined && (occurrences.get(s.id) ?? 0) > 1
				? `${s.id}@${s.date}`
				: String(s.id)
		const item = toCalendarItem(s, appointments, baseUrl, key)
		if (item) {
			items.set(item.key, item)
		}
	}
	return [...items.values()]
}

/** Counts plus the first error per mailbox. */
class Tally {
	readonly counts: CalendarSyncRunCounts = { ...EMPTY_COUNTS }
	private readonly errors = new Map<string, string>()

	fail(mailbox: string, error: Error): void {
		this.counts.failed++
		if (!this.errors.has(mailbox)) {
			this.errors.set(mailbox, error.message)
		}
	}

	error(): string | null {
		if (this.errors.size === 0) {
			return null
		}
		return [...this.errors].map(([mailbox, message]) => `${mailbox}: ${message}`).join('; ')
	}
}

/** Creates the event and stores its item row. */
async function create(
	graph: GraphClient,
	item: CalendarItem,
	mailbox: string,
	tally: Tally,
): Promise<boolean> {
	const created = await graph.createEvent(mailbox, toGraphEvent(item))
	if (Result.isError(created)) {
		tally.fail(mailbox, created.error)
		return false
	}
	await upsertItem({
		item_key: item.key,
		tanss_support_id: item.tanssId,
		tanss_employee_id: item.techId,
		mailbox_upn: mailbox,
		graph_event_id: created.value,
		hash: hash(item),
		start_at: item.start,
		synced_at: nowSeconds(),
	})
	return true
}

/** Deletes an event; one that is already gone counts as deleted. */
async function remove(graph: GraphClient, row: ItemRow, tally: Tally): Promise<boolean> {
	const deleted = await graph.deleteEvent(row.mailbox_upn, row.graph_event_id)
	if (Result.isError(deleted) && !isGraphNotFound(deleted.error)) {
		tally.fail(row.mailbox_upn, deleted.error)
		return false
	}
	return true
}

async function apply(
	graph: GraphClient,
	item: CalendarItem,
	mailbox: string,
	row: ItemRow | undefined,
	tally: Tally,
): Promise<void> {
	if (!row) {
		if (await create(graph, item, mailbox, tally)) {
			tally.counts.created++
		}
		return
	}
	if (row.mailbox_upn !== mailbox) {
		if ((await remove(graph, row, tally)) && (await create(graph, item, mailbox, tally))) {
			tally.counts.updated++
		}
		return
	}
	const itemHash = hash(item)
	if (row.hash === itemHash) {
		return
	}
	const updated = await graph.updateEvent(mailbox, row.graph_event_id, toGraphEvent(item))
	if (Result.isError(updated)) {
		if (!isGraphNotFound(updated.error)) {
			tally.fail(mailbox, updated.error)
			return
		}
		console.log(
			`Calendar sync: event of TANSS appointment ${item.key} was deleted in ${mailbox}; recreating it`,
		)
		if (await create(graph, item, mailbox, tally)) {
			tally.counts.created++
		}
		return
	}
	await upsertItem({ ...row, hash: itemHash, start_at: item.start, synced_at: nowSeconds() })
	tally.counts.updated++
}

async function execute(): Promise<Result<Tally, Error>> {
	const creds = await storedCredentials()
	if (Result.isError(creds)) {
		return creds
	}
	const tanss = await tanssSession()
	if (Result.isError(tanss)) {
		return tanss
	}
	const graph = new GraphClient(creds.value)
	const window = syncWindow(nowSeconds())
	const mappings = new Map<number, MappingRow>(
		(await listMappings()).map((m) => [m.tanss_employee_id, m]),
	)
	const active = new Set(
		[...mappings.values()].filter((m) => m.enabled === 1).map((m) => m.tanss_employee_id),
	)

	let desired: CalendarItem[] = []
	if (active.size > 0) {
		const appointments = await tanss.value.session.listAppointments(
			window.from,
			window.to,
			[...active],
			PLANNING_TYPES,
		)
		if (Result.isError(appointments)) {
			return appointments
		}
		desired = normalize(appointments.value, tanss.value.baseUrl, active)
	}

	const tally = new Tally()
	const rows = new Map((await listItems()).map((row) => [row.item_key, row]))
	for (const item of desired) {
		const mapping = mappings.get(item.techId)
		if (!mapping) {
			continue
		}
		const row = rows.get(item.key)
		rows.delete(item.key)
		await apply(graph, item, mapping.mailbox_upn, row, tally)
	}

	const gone: string[] = []
	for (const row of rows.values()) {
		const mapping = mappings.get(row.tanss_employee_id)
		const inWindow = row.start_at >= window.from && row.start_at < window.to
		// Disabled mappings are paused; aged-out items stay as they are.
		const drop = mapping === undefined || (mapping.enabled === 1 && inWindow)
		if (drop && (await remove(graph, row, tally))) {
			gone.push(row.item_key)
			tally.counts.deleted++
		}
	}
	await deleteItems(gone)
	return Result.ok(tally)
}

/** Runs the sync for an inserted `running` row and records the outcome. */
async function complete(run: RunRow): Promise<void> {
	let counts: CalendarSyncRunCounts = { ...EMPTY_COUNTS }
	let error: string | null
	try {
		const result = await execute()
		if (Result.isOk(result)) {
			counts = result.value.counts
			error = result.value.error()
		} else {
			error = result.error.message
		}
	} catch (e) {
		error = errOf(e).message
	}
	try {
		await finishRun(run.id, counts, error)
		await recordConfigError(error)
	} catch (e) {
		console.error('Failed to record calendar sync result:', e)
	}
}

/** Claims the run flag and inserts the `running` row. */
async function begin(): Promise<Result<RunRow, Error>> {
	if (running) {
		return Result.err(new ConflictError('A calendar sync is already running'))
	}
	running = true
	const run = await insertRun()
	if (Result.isError(run)) {
		running = false
	}
	return run
}

/** "Sync now": starts a run in the background and returns its `running` row. */
export async function startCalendarSync(): Promise<Result<CalendarSyncRunJson, Error>> {
	const config = await getConfigRow()
	if (!config) {
		return Result.err(new NotFoundError('Calendar sync is not configured'))
	}
	if (config.enabled !== 1) {
		return Result.err(new ConflictError('Calendar sync is disabled'))
	}
	const run = await begin()
	if (Result.isError(run)) {
		return run
	}
	void complete(run.value).finally(() => {
		running = false
	})
	return Result.ok(runJson(run.value))
}

/**
 * Sweep task (every minute): runs when enabled and `interval_minutes`
 * have passed since the last run started.
 */
export async function runCalendarSyncIfEnabled(): Promise<void> {
	if (running) {
		return
	}
	const config = await getConfigRow()
	if (config?.enabled !== 1) {
		return
	}
	const last = await lastRun()
	if (last && nowSeconds() - last.started_at < config.interval_minutes * 60) {
		return
	}
	const run = await begin()
	if (Result.isError(run)) {
		return
	}
	try {
		await complete(run.value)
	} finally {
		running = false
	}
}
