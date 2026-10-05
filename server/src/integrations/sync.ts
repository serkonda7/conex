/**
 * Sync runs: fetch external tenants (always all) and the devices of linked
 * tenants, store the snapshot, then auto-link devices (`match.ts`).
 *
 * A run is started in the background and tracked in `sync_runs`; the API
 * answers right away with the `running` row and the client polls. One run
 * per provider at a time.
 */
import { Result } from 'better-result'
import { and, eq } from 'drizzle-orm'
import type { IntegrationProvider as ProviderId, SyncRunJson } from 'shared/src/schemas'
import { getDb } from '../db/connection'
import { ConflictError, NotFoundError } from '../db/errors'
import { checkTenantExists, errOf } from '../db/list'
import { devices, sync_runs } from '../schema'
import { nowSeconds } from '../util/time'
import { listLinks, setLink } from './links'
import { matchDevices } from './match'
import { mergeTenants, pruneDevices, replaceDevices, replaceTenants } from './snapshot'
import {
	getIntegrationRow,
	lastSuccessfulSyncStartedAt,
	providerFor,
	recordConnection,
	syncRunJson,
} from './store'
import type { ExternalDevice, IntegrationProvider } from './types'

const running = new Set<ProviderId>()

interface Counts {
	tenants: number
	devices: number
	auto_linked: number
}

/** Auto-links unlinked devices of one tenant; returns the number of new links. */
async function autoLink(
	provider: ProviderId,
	tenantId: number,
	externalTenantId: string,
	fetched: ExternalDevice[],
): Promise<number> {
	const deviceLinks = await listLinks(provider, 'device')
	const linkedLocal = new Set<number>()
	const takenExternal = new Set<string>()
	for (const link of deviceLinks) {
		takenExternal.add(link.external_id)
		if (link.entity_id !== null) {
			linkedLocal.add(link.entity_id)
		}
	}
	const locals = (
		await getDb()
			.select({
				id: devices.id,
				name: devices.name,
				serial: devices.serial,
				asset_tag: devices.asset_tag,
			})
			.from(devices)
			.where(eq(devices.tenant_id, tenantId))
	).filter((d) => !linkedLocal.has(d.id))
	const externals = fetched.filter((e) => !takenExternal.has(e.external_id))
	const { auto } = matchDevices(locals, externals)
	let linked = 0
	for (const pair of auto) {
		const res = await setLink(
			provider,
			{
				entity_type: 'device',
				entity_id: pair.device_id,
				external_id: pair.external_id,
				external_tenant_id: externalTenantId,
			},
			'auto',
			null,
		)
		if (Result.isOk(res)) {
			linked++
		}
	}
	return linked
}

async function execute(
	provider: ProviderId,
	instance: IntegrationProvider,
	tenantId: number | null,
	clean: boolean,
): Promise<Result<Counts, Error>> {
	const now = nowSeconds()
	const modifiedSince = clean ? null : await lastSuccessfulSyncStartedAt(provider)
	const externalTenants = await instance.listTenants(modifiedSince ?? undefined)
	if (Result.isError(externalTenants)) {
		return externalTenants
	}
	let tenantSnapshot = externalTenants.value
	if (modifiedSince === null) {
		await replaceTenants(provider, tenantSnapshot, now)
	} else {
		tenantSnapshot = await mergeTenants(provider, tenantSnapshot, now)
	}
	const known = new Set(tenantSnapshot.map((t) => t.external_id))

	const tenantLinks = (await listLinks(provider, 'tenant')).filter(
		(link) =>
			link.state === 'linked' &&
			link.entity_id !== null &&
			(tenantId === null || link.entity_id === tenantId),
	)
	const counts: Counts = { tenants: tenantSnapshot.length, devices: 0, auto_linked: 0 }
	for (const link of tenantLinks) {
		// Stale links (company gone) are reported, not fetched.
		if (link.entity_id === null || !known.has(link.external_id)) {
			continue
		}
		const fetched = await instance.fetchDevices(link.external_id)
		if (Result.isError(fetched)) {
			return fetched
		}
		await replaceDevices(provider, link.external_id, fetched.value, now)
		counts.devices += fetched.value.length
		counts.auto_linked += await autoLink(
			provider,
			link.entity_id,
			link.external_id,
			fetched.value,
		)
	}
	if (tenantId === null) {
		await pruneDevices(
			provider,
			tenantLinks
				.filter((link) => known.has(link.external_id))
				.map((link) => link.external_id),
		)
	}
	return Result.ok(counts)
}

async function finish(
	runId: number,
	provider: ProviderId,
	result: Result<Counts, Error>,
): Promise<void> {
	try {
		await getDb()
			.update(sync_runs)
			.set(
				Result.isOk(result)
					? { state: 'ok', finished_at: nowSeconds(), counts: result.value }
					: { state: 'error', finished_at: nowSeconds(), error: result.error.message },
			)
			.where(eq(sync_runs.id, runId))
		await recordConnection(provider, Result.isOk(result) ? null : result.error.message)
	} catch (e) {
		console.error('Failed to record sync result:', e)
	}
}

/**
 * Starts a sync in the background and returns its `running` row.
 * `tenantId` limits device fetching to that tenant's company.
 */
export async function startSync(
	provider: ProviderId,
	tenantId: number | null,
	clean = false,
): Promise<Result<SyncRunJson, Error>> {
	const row = await getIntegrationRow(provider)
	if (Result.isError(row)) {
		return row
	}
	if (row.value.enabled !== 1) {
		return Result.err(new ConflictError('Integration is disabled'))
	}
	const tenant = await checkTenantExists(tenantId)
	if (Result.isError(tenant)) {
		return tenant
	}
	if (running.has(provider)) {
		return Result.err(new ConflictError('A sync is already running'))
	}
	const instance = providerFor(row.value)
	running.add(provider)
	let run: typeof sync_runs.$inferSelect | undefined
	try {
		run = (
			await getDb()
				.insert(sync_runs)
				.values({
					provider,
					tenant_id: tenantId,
					started_at: nowSeconds(),
					state: 'running',
				})
				.returning()
		)[0]
	} catch (e) {
		running.delete(provider)
		return Result.err(errOf(e))
	}
	if (!run) {
		running.delete(provider)
		return Result.err(new Error('Sync run insert returned no row'))
	}
	const runId = run.id
	void (async (): Promise<void> => {
		let result: Result<Counts, Error>
		try {
			result = Result.isError(instance)
				? instance
				: await execute(provider, instance.value, tenantId, clean)
		} catch (e) {
			result = Result.err(errOf(e))
		}
		await finish(runId, provider, result)
		running.delete(provider)
	})()
	return Result.ok(syncRunJson(run))
}

export async function getSyncRun(
	provider: ProviderId,
	id: number,
): Promise<Result<SyncRunJson, Error>> {
	const row = (
		await getDb()
			.select()
			.from(sync_runs)
			.where(and(eq(sync_runs.provider, provider), eq(sync_runs.id, id)))
			.limit(1)
	)[0]
	return row ? Result.ok(syncRunJson(row)) : Result.err(new NotFoundError('Sync run not found'))
}

/** Marks runs interrupted by a restart as failed. Called once at startup. */
export async function failInterruptedSyncs(): Promise<void> {
	await getDb()
		.update(sync_runs)
		.set({ state: 'error', finished_at: nowSeconds(), error: 'Interrupted by server restart' })
		.where(eq(sync_runs.state, 'running'))
}
