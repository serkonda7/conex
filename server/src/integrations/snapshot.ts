/**
 * `external_objects`: the last fetched state of each external tenant and
 * device. The report and the link pickers read from here, so they work
 * without calling the external system on every page load.
 */
import { and, eq, inArray, type SQL, sql } from 'drizzle-orm'
import type { IntegrationProvider as ProviderId } from 'shared/src/schemas'
import { getDb } from '../db/connection'
import { external_objects } from '../schema'
import type { ExternalDevice, ExternalTenant } from './types'

/** Rows per statement; keeps statements well under the Postgres parameter cap. */
const CHUNK = 500

type ObjectType = 'tenant' | 'device'
type ObjectRow = typeof external_objects.$inferInsert

function chunks<T>(items: T[]): T[][] {
	const out: T[][] = []
	for (let i = 0; i < items.length; i += CHUNK) {
		out.push(items.slice(i, i + CHUNK))
	}
	return out
}

/** Snapshot rows of one provider and object type, narrowed by `extra`. */
function objectsOf(provider: ProviderId, type: ObjectType, extra?: SQL): SQL | undefined {
	return and(
		eq(external_objects.provider, provider),
		eq(external_objects.object_type, type),
		extra,
	)
}

function tenantRows(provider: ProviderId, tenants: ExternalTenant[], now: number): ObjectRow[] {
	return tenants.map((tenant) => ({
		provider,
		object_type: 'tenant',
		external_id: tenant.external_id,
		external_tenant_id: tenant.external_id,
		data: tenant,
		fetched_at: now,
	}))
}

async function insertChunked(rows: ObjectRow[]): Promise<void> {
	for (const chunk of chunks(rows)) {
		await getDb().insert(external_objects).values(chunk)
	}
}

/** Replaces the whole tenant snapshot (the list is always fetched in full). */
export async function replaceTenants(
	provider: ProviderId,
	tenants: ExternalTenant[],
	now: number,
): Promise<void> {
	await getDb().delete(external_objects).where(objectsOf(provider, 'tenant'))
	await insertChunked(tenantRows(provider, tenants, now))
}

/** Applies a partial tenant update without dropping unchanged snapshot rows. */
export async function mergeTenants(
	provider: ProviderId,
	changedTenants: ExternalTenant[],
	now: number,
): Promise<ExternalTenant[]> {
	for (const chunk of chunks(tenantRows(provider, changedTenants, now))) {
		await getDb()
			.insert(external_objects)
			.values(chunk)
			.onConflictDoUpdate({
				target: [
					external_objects.provider,
					external_objects.object_type,
					external_objects.external_id,
				],
				set: {
					external_tenant_id: sql`excluded.external_tenant_id`,
					data: sql`excluded.data`,
					fetched_at: sql`excluded.fetched_at`,
				},
			})
	}
	return [...(await readTenants(provider)).values()]
}

/** Replaces the device snapshot of one external tenant. */
export async function replaceDevices(
	provider: ProviderId,
	externalTenantId: string,
	devices: ExternalDevice[],
	now: number,
): Promise<void> {
	await getDb()
		.delete(external_objects)
		.where(
			objectsOf(
				provider,
				'device',
				eq(external_objects.external_tenant_id, externalTenantId),
			),
		)
	// A device moved between companies may still sit under its old company.
	for (const ids of chunks(devices.map((device) => device.external_id))) {
		await getDb()
			.delete(external_objects)
			.where(objectsOf(provider, 'device', inArray(external_objects.external_id, ids)))
	}
	await insertChunked(
		devices.map((device) => ({
			provider,
			object_type: 'device',
			external_id: device.external_id,
			external_tenant_id: externalTenantId,
			data: device,
			fetched_at: now,
		})),
	)
}

/** Drops device snapshots of external tenants that are no longer linked. */
export async function pruneDevices(provider: ProviderId, keepTenantIds: string[]): Promise<void> {
	const rows = await getDb()
		.selectDistinct({ id: external_objects.external_tenant_id })
		.from(external_objects)
		.where(objectsOf(provider, 'device'))
	const drop = rows
		.map((row) => row.id)
		.filter((id): id is string => id !== null && !keepTenantIds.includes(id))
	if (drop.length === 0) {
		return
	}
	await getDb()
		.delete(external_objects)
		.where(objectsOf(provider, 'device', inArray(external_objects.external_tenant_id, drop)))
}

async function readData<T>(where: SQL | undefined): Promise<T[]> {
	const rows = await getDb()
		.select({ data: external_objects.data })
		.from(external_objects)
		.where(where)
	return rows.map((row) => row.data as T)
}

export async function readTenants(provider: ProviderId): Promise<Map<string, ExternalTenant>> {
	const tenants = await readData<ExternalTenant>(objectsOf(provider, 'tenant'))
	return new Map(tenants.map((tenant) => [tenant.external_id, tenant]))
}

export async function readTenant(
	provider: ProviderId,
	externalId: string,
): Promise<ExternalTenant | null> {
	const [tenant] = await readData<ExternalTenant>(
		objectsOf(provider, 'tenant', eq(external_objects.external_id, externalId)),
	)
	return tenant ?? null
}

/** Devices of the given external tenants (all when omitted). */
export async function readDevices(
	provider: ProviderId,
	externalTenantIds?: string[],
): Promise<ExternalDevice[]> {
	if (externalTenantIds !== undefined && externalTenantIds.length === 0) {
		return []
	}
	return readData<ExternalDevice>(
		objectsOf(
			provider,
			'device',
			externalTenantIds !== undefined
				? inArray(external_objects.external_tenant_id, externalTenantIds)
				: undefined,
		),
	)
}

export async function readDevice(
	provider: ProviderId,
	externalId: string,
): Promise<ExternalDevice | null> {
	const [device] = await readData<ExternalDevice>(
		objectsOf(provider, 'device', eq(external_objects.external_id, externalId)),
	)
	return device ?? null
}

/** Adds or replaces one device in the snapshot (e.g. right after creating it). */
export async function upsertDevice(
	provider: ProviderId,
	device: ExternalDevice,
	now: number,
): Promise<void> {
	await getDb()
		.insert(external_objects)
		.values({
			provider,
			object_type: 'device',
			external_id: device.external_id,
			external_tenant_id: device.external_tenant_id,
			data: device,
			fetched_at: now,
		})
		.onConflictDoUpdate({
			target: [
				external_objects.provider,
				external_objects.object_type,
				external_objects.external_id,
			],
			set: {
				external_tenant_id: sql`excluded.external_tenant_id`,
				data: sql`excluded.data`,
				fetched_at: sql`excluded.fetched_at`,
			},
		})
}
