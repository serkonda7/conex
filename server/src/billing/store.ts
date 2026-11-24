/**
 * Billing periods: live counts, snapshots and their reports. A period that
 * is not stored yet shows live counts while it runs, and also once its
 * cutoff has passed until its snapshot is taken (automatically within
 * `AUTO_SNAPSHOT_GRACE_S`, or by hand). Drafts can be retaken and their
 * stored data edited; final periods never change.
 */
import { Result } from 'better-result'
import { and, asc, desc, eq, lt } from 'drizzle-orm'
import type {
	BillingCountJson,
	BillingItemJson,
	BillingItemsQuery,
	BillingMetric,
	BillingOverviewJson,
	BillingPeriodJson,
	BillingPeriodState,
	BillingReportJson,
	BillingStorageInput,
} from 'shared/src/schemas'
import { getDb, withTransaction } from '../db/connection'
import { ConflictError, NotFoundError } from '../db/errors'
import { getGlobalSettings } from '../db/global_settings'
import { errOf, tryWrite } from '../db/list'
import {
	billing_counts,
	billing_inputs,
	billing_items,
	billing_periods,
	tenant_bundles,
} from '../schema'
import { toCsv } from '../util/csv'
import { nowSeconds } from '../util/time'
import {
	type BillingData,
	type CountRow,
	computeBilling,
	type ItemRow,
	itemKey,
	lineKey,
	lotsOf,
	storageInputs,
} from './compute'
import { AUTO_SNAPSHOT_GRACE_S, currentPeriod, cutoffAt, duePeriod } from './period'

type PeriodRow = typeof billing_periods.$inferSelect

/** Rows inserted per statement (bind parameter limit). */
const INSERT_CHUNK = 1000

function periodJson(row: PeriodRow): BillingPeriodJson {
	return {
		period: row.period,
		state: row.state as BillingPeriodState,
		cutoff_at: row.cutoff_at,
		taken_at: row.taken_at,
		taken_by: row.taken_by,
		finalized_at: row.finalized_at,
		finalized_by: row.finalized_by,
	}
}

async function cutoffDay(): Promise<Result<number | null, Error>> {
	return (await getGlobalSettings()).map((s) => s.billing_cutoff_day)
}

async function periodRow(period: string): Promise<PeriodRow | null> {
	const [row] = await getDb()
		.select()
		.from(billing_periods)
		.where(eq(billing_periods.period, period))
		.limit(1)
	return row ?? null
}

/** Latest stored period before `period`. */
async function previousRow(period: string): Promise<PeriodRow | null> {
	const [row] = await getDb()
		.select()
		.from(billing_periods)
		.where(lt(billing_periods.period, period))
		.orderBy(desc(billing_periods.period))
		.limit(1)
	return row ?? null
}

async function storedCounts(period: string): Promise<CountRow[]> {
	const rows = await getDb()
		.select()
		.from(billing_counts)
		.where(eq(billing_counts.period, period))
		.orderBy(asc(billing_counts.tenant_name), asc(billing_counts.tenant_id))
	return rows.map(({ period: _p, carried, ...r }) => ({
		...r,
		metric: r.metric as BillingMetric,
		carried: carried === 1,
	}))
}

async function storedItems(period: string): Promise<ItemRow[]> {
	const rows = await getDb()
		.select()
		.from(billing_items)
		.where(eq(billing_items.period, period))
		.orderBy(asc(billing_items.item_repr))
	return rows.map(({ period: _p, ...r }) => ({
		...r,
		metric: r.metric as BillingMetric,
		item_type: r.item_type as ItemRow['item_type'],
	}))
}

interface PeriodData extends BillingData {
	period: string
	cutoff_at: number
	snapshot: PeriodRow | null
}

/**
 * Stored data of `period`, or live counts while it runs or waits for its
 * snapshot; any other unstored period is not found.
 */
async function loadPeriod(period: string): Promise<Result<PeriodData, Error>> {
	const day = await cutoffDay()
	if (Result.isError(day)) {
		return day
	}
	try {
		const row = await periodRow(period)
		if (row) {
			return Result.ok({
				period,
				cutoff_at: row.cutoff_at,
				snapshot: row,
				bundles: row.bundles,
				counts: await storedCounts(period),
				items: await storedItems(period),
				exceptions: row.exceptions,
			})
		}
		const now = nowSeconds()
		if (period !== currentPeriod(now, day.value) && period !== duePeriod(now, day.value)) {
			return Result.err(new NotFoundError('No snapshot for this billing period'))
		}
		const live = await computeBilling(period, now)
		return live.map((data) => ({
			...data,
			period,
			cutoff_at: cutoffAt(period, day.value),
			snapshot: null,
		}))
	} catch (err) {
		return Result.err(errOf(err))
	}
}

/** Stored periods, newest first, and where the calendar stands. */
export async function getBillingOverview(): Promise<Result<BillingOverviewJson, Error>> {
	const day = await cutoffDay()
	if (Result.isError(day)) {
		return day
	}
	try {
		const rows = await getDb()
			.select()
			.from(billing_periods)
			.orderBy(desc(billing_periods.period))
		const now = nowSeconds()
		return Result.ok({
			periods: rows.map(periodJson),
			current_period: currentPeriod(now, day.value),
			due_period: duePeriod(now, day.value),
			cutoff_day: day.value,
		})
	} catch (err) {
		return Result.err(errOf(err))
	}
}

/** Items of `data` keyed for the diff. */
function itemMap(items: ItemRow[]): Map<string, ItemRow> {
	return new Map(items.map((i) => [itemKey(i), i]))
}

/** Counts, exceptions and changes of `period` against the previous snapshot. */
export async function getBillingReport(period: string): Promise<Result<BillingReportJson, Error>> {
	const data = await loadPeriod(period)
	if (Result.isError(data)) {
		return data
	}
	try {
		const previous = await previousRow(period)
		const prevCounts = previous ? await storedCounts(previous.period) : []
		const prevLots = new Map(prevCounts.map((c) => [lineKey(c), c.lots]))
		let added = 0
		let removed = 0
		if (previous) {
			const before = itemMap(await storedItems(previous.period))
			const after = itemMap(data.value.items)
			added = [...after.keys()].filter((k) => !before.has(k)).length
			removed = [...before.keys()].filter((k) => !after.has(k)).length
		}
		const counts: BillingCountJson[] = data.value.counts.map((c) => ({
			...c,
			previous_lots: prevLots.get(lineKey(c)) ?? null,
		}))
		return Result.ok({
			period,
			cutoff_at: data.value.cutoff_at,
			snapshot: data.value.snapshot ? periodJson(data.value.snapshot) : null,
			previous_period: previous?.period ?? null,
			bundles: data.value.bundles,
			counts,
			exceptions: data.value.exceptions,
			added,
			removed,
		})
	} catch (err) {
		return Result.err(errOf(err))
	}
}

/**
 * Objects behind the counts with their change against the previous
 * snapshot (removed ones last), optionally narrowed to one line.
 */
export async function getBillingItems(
	period: string,
	line?: BillingItemsQuery,
): Promise<Result<BillingItemJson[], Error>> {
	const data = await loadPeriod(period)
	if (Result.isError(data)) {
		return data
	}
	try {
		const previous = await previousRow(period)
		const matches = (i: ItemRow): boolean =>
			!line ||
			(i.tenant_id === line.tenant && i.bundle_id === line.bundle && i.metric === line.metric)
		const now = data.value.items.filter(matches)
		const before = previous
			? itemMap((await storedItems(previous.period)).filter(matches))
			: null
		const after = itemMap(now)
		// Names of the current period; a line gone since keeps the old one.
		const prevCounts = previous ? await storedCounts(previous.period) : []
		const names = new Map<string, { tenant: string; bundle: string }>()
		for (const c of [...prevCounts, ...data.value.counts]) {
			names.set(lineKey(c), { tenant: c.tenant_name, bundle: c.bundle_name })
		}
		const json = (i: ItemRow, change: BillingItemJson['change']): BillingItemJson => ({
			...i,
			tenant_name: names.get(lineKey(i))?.tenant ?? '',
			bundle_name: names.get(lineKey(i))?.bundle ?? '',
			change,
		})
		const out = now.map((i) => json(i, before && !before.has(itemKey(i)) ? 'added' : null))
		for (const [key, i] of before ?? []) {
			if (!after.has(key)) {
				out.push(json(i, 'removed'))
			}
		}
		return Result.ok(out)
	} catch (err) {
		return Result.err(errOf(err))
	}
}

/** Added and removed objects of `period` across all lines. */
export async function getBillingChanges(period: string): Promise<Result<BillingItemJson[], Error>> {
	return (await getBillingItems(period)).map((items) =>
		items
			.filter((i) => i.change !== null)
			.sort(
				(a, b) =>
					a.tenant_name.localeCompare(b.tenant_name) ||
					a.bundle_name.localeCompare(b.bundle_name) ||
					a.metric.localeCompare(b.metric) ||
					a.item_repr.localeCompare(b.item_repr),
			),
	)
}

async function insertChunks<T extends Record<string, unknown>>(
	rows: T[],
	insert: (chunk: T[]) => Promise<unknown>,
): Promise<void> {
	for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
		await insert(rows.slice(i, i + INSERT_CHUNK))
	}
}

/**
 * Stores the current counts as the snapshot of `period` (the due period
 * only: any other would freeze today's inventory under the wrong month).
 * Replaces a draft; a final period is refused. `takenBy` null = automatic.
 */
export async function takeBillingSnapshot(
	period: string,
	takenBy: string | null,
): Promise<Result<BillingPeriodJson, Error>> {
	const day = await cutoffDay()
	if (Result.isError(day)) {
		return day
	}
	const now = nowSeconds()
	if (period !== duePeriod(now, day.value)) {
		return Result.err(
			new ConflictError('Only the latest period whose cutoff has passed can be snapshotted'),
		)
	}
	const existing = await periodRow(period)
	if (existing?.state === 'final') {
		return Result.err(new ConflictError('Billing period is final'))
	}
	const data = await computeBilling(period, now)
	if (Result.isError(data)) {
		return data
	}
	const row: PeriodRow = {
		period,
		state: 'draft',
		cutoff_at: cutoffAt(period, day.value),
		taken_at: now,
		taken_by: takenBy,
		finalized_at: null,
		finalized_by: null,
		bundles: data.value.bundles,
		exceptions: data.value.exceptions,
	}
	const written = await tryWrite(() =>
		withTransaction(async () => {
			const db = getDb()
			// Counts and items go with the old row (cascade).
			await db.delete(billing_periods).where(eq(billing_periods.period, period))
			await db.insert(billing_periods).values(row)
			await insertChunks(
				data.value.counts.map((c) => ({ ...c, period, carried: c.carried ? 1 : 0 })),
				(chunk) => db.insert(billing_counts).values(chunk),
			)
			await insertChunks(
				data.value.items.map((i) => ({ ...i, period })),
				(chunk) => db.insert(billing_items).values(chunk),
			)
		}),
	)
	return written.map(() => periodJson(row))
}

/** Locks a draft: it can no longer be retaken or edited. */
export async function finalizeBillingPeriod(
	period: string,
	finalizedBy: string,
): Promise<Result<BillingPeriodJson, Error>> {
	const row = await periodRow(period)
	if (!row) {
		return Result.err(new NotFoundError('No snapshot for this billing period'))
	}
	if (row.state === 'final') {
		return Result.err(new ConflictError('Billing period is already final'))
	}
	const patch = { state: 'final', finalized_at: nowSeconds(), finalized_by: finalizedBy }
	const written = await tryWrite(() =>
		getDb().update(billing_periods).set(patch).where(eq(billing_periods.period, period)),
	)
	return written.map(() => periodJson({ ...row, ...patch }))
}

/**
 * Stores (or clears) the GB of backup data of a contract for `period`. A
 * draft snapshot of the period takes the new value at once; a final one
 * refuses it.
 */
export async function setBillingStorage(
	period: string,
	input: BillingStorageInput,
	updatedBy: string,
): Promise<Result<BillingCountJson | null, Error>> {
	const loaded = await loadPeriod(period)
	if (Result.isError(loaded)) {
		return loaded
	}
	const snapshot = loaded.value.snapshot
	if (snapshot?.state === 'final') {
		return Result.err(new ConflictError('Billing period is final'))
	}
	const line = { tenant_id: input.tenant_id, bundle_id: input.bundle_id, metric: 'storage' }
	const config = loaded.value.bundles
		.find((b) => b.id === input.bundle_id)
		?.metrics.find((m) => m.metric === 'storage')
	const count = loaded.value.counts.find((c) => lineKey(c) === lineKey(line))
	if (!config || !count) {
		return Result.err(new NotFoundError('The contract does not bill stored data'))
	}
	const key = and(
		eq(billing_inputs.tenant_id, input.tenant_id),
		eq(billing_inputs.bundle_id, input.bundle_id),
		eq(billing_inputs.metric, 'storage'),
		eq(billing_inputs.period, period),
	)
	const written = await tryWrite(() =>
		withTransaction(async () => {
			const db = getDb()
			if (input.gb === null) {
				await db.delete(billing_inputs).where(key)
			} else {
				const values = {
					quantity: input.gb,
					updated_at: nowSeconds(),
					updated_by: updatedBy,
				}
				await db
					.insert(billing_inputs)
					.values({ ...line, period, ...values })
					.onConflictDoUpdate({
						target: [
							billing_inputs.tenant_id,
							billing_inputs.bundle_id,
							billing_inputs.metric,
							billing_inputs.period,
						],
						set: values,
					})
			}
			const resolved = (await storageInputs(period)).get(lineKey(line))
			const quantity = resolved?.gb ?? 0
			const updated: CountRow = {
				...count,
				quantity,
				lots: lotsOf(config, quantity),
				carried: resolved?.carried ?? false,
			}
			if (snapshot) {
				const exceptions = snapshot.exceptions.filter(
					(e) =>
						!(
							e.kind === 'storage_missing' &&
							e.tenant_id === input.tenant_id &&
							e.bundle_id === input.bundle_id
						),
				)
				if (!resolved) {
					exceptions.push({
						kind: 'storage_missing',
						tenant_id: count.tenant_id,
						tenant_name: count.tenant_name,
						bundle_id: count.bundle_id,
						bundle_name: count.bundle_name,
						item_type: null,
						ref_id: null,
						item_repr: null,
					})
				}
				await db
					.update(billing_counts)
					.set({
						quantity: updated.quantity,
						lots: updated.lots,
						carried: updated.carried ? 1 : 0,
					})
					.where(
						and(
							eq(billing_counts.period, period),
							eq(billing_counts.tenant_id, input.tenant_id),
							eq(billing_counts.bundle_id, input.bundle_id),
							eq(billing_counts.metric, 'storage'),
						),
					)
				await db
					.update(billing_periods)
					.set({ exceptions })
					.where(eq(billing_periods.period, period))
			}
			return updated
		}),
	)
	return written.map((c) => ({ ...c, previous_lots: null }))
}

/** One row per billed line, for the invoicing system. */
export async function exportBillingCsv(period: string): Promise<Result<string, Error>> {
	const report = await getBillingReport(period)
	return report.map((r) =>
		toCsv(
			[
				'period',
				'customer_number',
				'tenant',
				'bundle',
				'service_level',
				'metric',
				'quantity',
				'lots',
				'previous_lots',
			],
			r.counts.map((c) => [
				period,
				c.customer_number,
				c.tenant_name,
				c.bundle_name,
				c.service_level_name,
				c.metric,
				String(c.quantity),
				String(c.lots),
				c.previous_lots === null ? null : String(c.previous_lots),
			]),
		),
	)
}

/**
 * Periodic task: snapshots the due period once its cutoff has passed,
 * unless it is stored already or the cutoff lies too far back (a late
 * snapshot would bill today's inventory for an old month).
 */
export async function autoBillingSnapshot(): Promise<void> {
	const day = await cutoffDay()
	if (Result.isError(day)) {
		throw day.error
	}
	const now = nowSeconds()
	const period = duePeriod(now, day.value)
	if (now - cutoffAt(period, day.value) > AUTO_SNAPSHOT_GRACE_S || (await periodRow(period))) {
		return
	}
	// Nothing to bill before the first contract.
	const [contract] = await getDb().select().from(tenant_bundles).limit(1)
	if (!contract) {
		return
	}
	const taken = await takeBillingSnapshot(period, null)
	if (Result.isError(taken)) {
		throw taken.error
	}
	console.log(`Billing snapshot taken for ${period}`)
}
