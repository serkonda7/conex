/**
 * Sync runs: fetch external tenants, employees and ticket tags (always all)
 * and the devices of linked tenants (or sites), store the snapshot, then
 * auto-link devices and employees (`match.ts`).
 *
 * A run is started in the background and tracked in `sync_runs`; the API
 * answers right away with the `running` row and the client polls. One run
 * per provider at a time. Enabled integrations also sync on their own every
 * 30 minutes (`runDueSyncs`).
 */
import { Result } from 'better-result'
import { and, desc, eq, isNull } from 'drizzle-orm'
import type { IntegrationProvider as ProviderId, SyncRunJson } from 'shared/src/schemas'
import { getConfig } from '../config'
import { getDb } from '../db/connection'
import { memberOf } from '../db/employees'
import { ConflictError, NotFoundError } from '../db/errors'
import { checkTenantExists, errOf } from '../db/list'
import { failInterruptedRuns } from '../db/runs'
import { devices, employees, integrations, sync_runs } from '../schema'
import { nowSeconds } from '../util/time'
import { listLinks, type ScopeLink, scopeLinks, setLink } from './links'
import { matchDevices, matchEmployees } from './match'
import { providerDefinition } from './registry'
import {
	hasEmployees,
	mergeEmployees,
	mergeTenants,
	pruneDevices,
	readEmployees,
	replaceDevices,
	replaceEmployees,
	replaceTags,
	replaceTenants,
} from './snapshot'
import {
	getIntegrationRow,
	lastSuccessfulSyncStartedAt,
	providerFor,
	recordConnection,
	syncRunJson,
} from './store'
import type { ExternalDevice, ExternalEmployee, IntegrationProvider } from './types'

const running = new Set<ProviderId>()

interface Counts {
	tenants: number
	devices: number
	employees: number
	auto_linked: number
}

/** External ids that already have a link row, and conex ids that are linked. */
async function linkState(
	provider: ProviderId,
	entityType: 'device' | 'employee',
): Promise<{ linkedLocal: Set<number>; takenExternal: Set<string> }> {
	const linkedLocal = new Set<number>()
	const takenExternal = new Set<string>()
	for (const link of await listLinks(provider, entityType)) {
		takenExternal.add(link.external_id)
		if (link.entity_id !== null) {
			linkedLocal.add(link.entity_id)
		}
	}
	return { linkedLocal, takenExternal }
}

/** Writes auto links; returns the number of new links. */
async function writeAutoLinks(
	provider: ProviderId,
	entityType: 'device' | 'employee',
	externalTenantId: string,
	pairs: { local_id: number; external_id: string }[],
): Promise<number> {
	let linked = 0
	for (const pair of pairs) {
		const res = await setLink(
			provider,
			{
				entity_type: entityType,
				entity_id: pair.local_id,
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

/**
 * Auto-links unlinked devices of the linked tenant, or of the linked site for
 * site links; returns the number of new links.
 */
async function autoLink(
	provider: ProviderId,
	scope: ScopeLink,
	fetched: ExternalDevice[],
): Promise<number> {
	const where =
		scope.site_id !== null
			? eq(devices.site_id, scope.site_id)
			: scope.tenant_id !== null
				? eq(devices.tenant_id, scope.tenant_id)
				: null
	if (where === null) {
		return 0
	}
	const { linkedLocal, takenExternal } = await linkState(provider, 'device')
	const locals = (
		await getDb()
			.select({
				id: devices.id,
				name: devices.name,
				serial: devices.serial,
				asset_tag: devices.asset_tag,
			})
			.from(devices)
			.where(where)
	).filter((d) => !linkedLocal.has(d.id))
	const externals = fetched.filter((e) => !takenExternal.has(e.external_id))
	const { auto } = matchDevices(locals, externals)
	return writeAutoLinks(
		provider,
		'device',
		scope.link.external_id,
		auto.map((pair) => ({ local_id: pair.device_id, external_id: pair.external_id })),
	)
}

/** Auto-links unlinked employees of one tenant; returns the number of new links. */
async function autoLinkEmployees(
	provider: ProviderId,
	tenantId: number,
	externalTenantId: string,
	snapshot: ExternalEmployee[],
): Promise<number> {
	const { linkedLocal, takenExternal } = await linkState(provider, 'employee')
	const locals = (
		await getDb()
			.select({ id: employees.id, name: employees.name, emails: employees.emails })
			.from(employees)
			.where(memberOf(tenantId))
	).filter((e) => !linkedLocal.has(e.id))
	const externals = snapshot.filter(
		(e) =>
			e.external_tenant_ids.includes(externalTenantId) && !takenExternal.has(e.external_id),
	)
	const { auto } = matchEmployees(locals, externals)
	return writeAutoLinks(
		provider,
		'employee',
		externalTenantId,
		auto.map((pair) => ({ local_id: pair.employee_id, external_id: pair.external_id })),
	)
}

async function execute(
	provider: ProviderId,
	instance: IntegrationProvider,
	tenantId: number | null,
	clean: boolean,
): Promise<Result<Counts, Error>> {
	const now = nowSeconds()
	const definition = providerDefinition(provider)
	// Non-incremental providers always replace the snapshot. Snapshots from
	// before employees were synced need one full fetch.
	const full =
		clean ||
		!definition.incremental ||
		(definition.capabilities.employees && !(await hasEmployees(provider)))
	const modifiedSince = full ? null : await lastSuccessfulSyncStartedAt(provider)
	const directory = await instance.listTenants(modifiedSince ?? undefined)
	if (Result.isError(directory)) {
		return directory
	}
	let tenantSnapshot = directory.value.tenants
	let employeeSnapshot = directory.value.employees
	if (modifiedSince === null) {
		await replaceTenants(provider, tenantSnapshot, now)
		await replaceEmployees(provider, employeeSnapshot, now)
	} else {
		tenantSnapshot = await mergeTenants(provider, tenantSnapshot, now)
		await mergeEmployees(provider, employeeSnapshot, now)
		employeeSnapshot = await readEmployees(provider)
	}
	if (instance.listTags) {
		const tags = await instance.listTags()
		if (Result.isError(tags)) {
			return tags
		}
		await replaceTags(provider, tags.value, now)
	}
	const known = new Set(tenantSnapshot.map((t) => t.external_id))

	const scopes = await scopeLinks(provider, tenantId === null ? undefined : [tenantId])
	const counts: Counts = {
		tenants: tenantSnapshot.length,
		devices: 0,
		employees: employeeSnapshot.length,
		auto_linked: 0,
	}
	// Site-level providers link one external tenant per site, so a tenant
	// may have several; they are fetched and auto-linked one by one and
	// `linkState` keeps a device from being linked twice.
	for (const scope of scopes) {
		const { link } = scope
		// Stale links (company gone) are reported, not fetched.
		if (!known.has(link.external_id)) {
			continue
		}
		const fetched = await instance.fetchDevices(link.external_id)
		if (Result.isError(fetched)) {
			return fetched
		}
		await replaceDevices(provider, link.external_id, fetched.value, now)
		counts.devices += fetched.value.length
		counts.auto_linked += await autoLink(provider, scope, fetched.value)
		if (definition.capabilities.employees && scope.tenant_id !== null) {
			counts.auto_linked += await autoLinkEmployees(
				provider,
				scope.tenant_id,
				link.external_id,
				employeeSnapshot,
			)
		}
	}
	if (tenantId === null) {
		await pruneDevices(
			provider,
			scopes
				.filter((scope) => known.has(scope.link.external_id))
				.map((scope) => scope.link.external_id),
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
 * `tenantId` limits device fetching to that tenant's company (or the
 * consoles of its sites).
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

/** Marks interrupted integration sync runs as failed. Called once at startup. */
export async function failInterruptedSyncs(): Promise<void> {
	await failInterruptedRuns(sync_runs)
}

/** A full sync starts on its own once the last one is this old. */
export const AUTO_SYNC_INTERVAL_SECONDS = 30 * 60

/**
 * Sweep task (every minute): starts a full sync for every enabled integration
 * whose last full run (any outcome, so a failing one retries on the same
 * schedule, not every tick) started at least `AUTO_SYNC_INTERVAL_SECONDS`
 * ago, or that never ran.
 * Tenant-scoped runs do not count, since they skip the other tenants' devices.
 * Skipped in `offline` mode, where every run would only fail.
 */
export async function runDueSyncs(): Promise<void> {
	if (getConfig().integrations.mode === 'offline') {
		return
	}
	const enabled = await getDb()
		.select({ provider: integrations.provider })
		.from(integrations)
		.where(eq(integrations.enabled, 1))
	if (enabled.length === 0) {
		return
	}
	const lastFull = await getDb()
		.selectDistinctOn([sync_runs.provider], {
			provider: sync_runs.provider,
			started_at: sync_runs.started_at,
		})
		.from(sync_runs)
		.where(isNull(sync_runs.tenant_id))
		.orderBy(sync_runs.provider, desc(sync_runs.started_at), desc(sync_runs.id))
	const startedAt = new Map(lastFull.map((run) => [run.provider, run.started_at]))
	const now = nowSeconds()
	for (const { provider } of enabled) {
		const last = startedAt.get(provider)
		if (running.has(provider as ProviderId)) {
			continue
		}
		if (last !== undefined && now - last < AUTO_SYNC_INTERVAL_SECONDS) {
			continue
		}
		const started = await startSync(provider as ProviderId, null)
		if (Result.isError(started)) {
			console.error(`Automatic ${provider} sync failed to start:`, started.error.message)
		}
	}
}
