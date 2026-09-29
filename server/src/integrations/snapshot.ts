/**
 * `external_objects`: the last fetched state of each external tenant and
 * device. The report and the link pickers read from here, so they work
 * without calling the external system on every page load.
 */
import { and, eq, inArray, sql } from 'drizzle-orm'
import type { IntegrationProvider as ProviderId } from 'shared/src/schemas'
import { getDb } from '../db/connection'
import { external_objects } from '../schema'
import type { ExternalDevice, ExternalTenant } from './types'

/** Rows per INSERT; keeps statements well under the Postgres parameter cap. */
const CHUNK = 500

async function insertChunked(rows: (typeof external_objects.$inferInsert)[]): Promise<void> {
	for (let i = 0; i < rows.length; i += CHUNK) {
		await getDb()
			.insert(external_objects)
			.values(rows.slice(i, i + CHUNK))
	}
}

/** Replaces the whole tenant snapshot (the list is always fetched in full). */
export async function replaceTenants(
	provider: ProviderId,
	tenants: ExternalTenant[],
	now: number,
): Promise<void> {
	await getDb()
		.delete(external_objects)
		.where(
			and(
				eq(external_objects.provider, provider),
				eq(external_objects.object_type, 'tenant'),
			),
		)
	await insertChunked(
		tenants.map((tenant) => ({
			provider,
			object_type: 'tenant',
			external_id: tenant.external_id,
			external_tenant_id: tenant.external_id,
			data: tenant,
			fetched_at: now,
		})),
	)
}

/** Applies a partial tenant update without dropping unchanged snapshot rows. */
export async function mergeTenants(
	provider: ProviderId,
	changedTenants: ExternalTenant[],
	now: number,
): Promise<ExternalTenant[]> {
	const rows = changedTenants.map((tenant) => ({
		provider,
		object_type: 'tenant',
		external_id: tenant.external_id,
		external_tenant_id: tenant.external_id,
		data: tenant,
		fetched_at: now,
	}))
	for (let i = 0; i < rows.length; i += CHUNK) {
		await getDb()
			.insert(external_objects)
			.values(rows.slice(i, i + CHUNK))
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
			and(
				eq(external_objects.provider, provider),
				eq(external_objects.object_type, 'device'),
				eq(external_objects.external_tenant_id, externalTenantId),
			),
		)
	// A device moved between companies may still sit under its old company.
	const ids = devices.map((device) => device.external_id)
	for (let i = 0; i < ids.length; i += CHUNK) {
		await getDb()
			.delete(external_objects)
			.where(
				and(
					eq(external_objects.provider, provider),
					eq(external_objects.object_type, 'device'),
					inArray(external_objects.external_id, ids.slice(i, i + CHUNK)),
				),
			)
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
		.where(
			and(
				eq(external_objects.provider, provider),
				eq(external_objects.object_type, 'device'),
			),
		)
	const drop = rows
		.map((row) => row.id)
		.filter((id): id is string => id !== null && !keepTenantIds.includes(id))
	if (drop.length === 0) {
		return
	}
	await getDb()
		.delete(external_objects)
		.where(
			and(
				eq(external_objects.provider, provider),
				eq(external_objects.object_type, 'device'),
				inArray(external_objects.external_tenant_id, drop),
			),
		)
}

export async function readTenants(provider: ProviderId): Promise<Map<string, ExternalTenant>> {
	const rows = await getDb()
		.select({ data: external_objects.data })
		.from(external_objects)
		.where(
			and(
				eq(external_objects.provider, provider),
				eq(external_objects.object_type, 'tenant'),
			),
		)
	const out = new Map<string, ExternalTenant>()
	for (const row of rows) {
		const tenant = row.data as ExternalTenant
		out.set(tenant.external_id, tenant)
	}
	return out
}

export async function readTenant(
	provider: ProviderId,
	externalId: string,
): Promise<ExternalTenant | null> {
	const row = (
		await getDb()
			.select({ data: external_objects.data })
			.from(external_objects)
			.where(
				and(
					eq(external_objects.provider, provider),
					eq(external_objects.object_type, 'tenant'),
					eq(external_objects.external_id, externalId),
				),
			)
			.limit(1)
	)[0]
	return row ? (row.data as ExternalTenant) : null
}

/** Devices of the given external tenants (all when omitted). */
export async function readDevices(
	provider: ProviderId,
	externalTenantIds?: string[],
): Promise<ExternalDevice[]> {
	if (externalTenantIds !== undefined && externalTenantIds.length === 0) {
		return []
	}
	const rows = await getDb()
		.select({ data: external_objects.data })
		.from(external_objects)
		.where(
			and(
				eq(external_objects.provider, provider),
				eq(external_objects.object_type, 'device'),
				externalTenantIds !== undefined
					? inArray(external_objects.external_tenant_id, externalTenantIds)
					: undefined,
			),
		)
	return rows.map((row) => row.data as ExternalDevice)
}

export async function readDevice(
	provider: ProviderId,
	externalId: string,
): Promise<ExternalDevice | null> {
	const row = (
		await getDb()
			.select({ data: external_objects.data })
			.from(external_objects)
			.where(
				and(
					eq(external_objects.provider, provider),
					eq(external_objects.object_type, 'device'),
					eq(external_objects.external_id, externalId),
				),
			)
			.limit(1)
	)[0]
	return row ? (row.data as ExternalDevice) : null
}
