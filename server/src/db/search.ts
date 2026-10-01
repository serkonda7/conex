import { and, asc, eq, type SQL } from 'drizzle-orm'
import type { PgColumn } from 'drizzle-orm/pg-core'
import { cables, devices, racks, sites, tenants } from '../schema'
import { cableInTenant } from './cables'
import { getDb } from './connection'
import { searchCondition } from './list'

export interface SearchGroup<T> {
	items: T[]
	total: number
}

export interface GlobalSearchResponse {
	q: string
	tenants: SearchGroup<{ id: number; name: string }>
	sites: SearchGroup<{ id: number; name: string }>
	racks: SearchGroup<{ id: number; name: string }>
	devices: SearchGroup<{ id: number; name: string; asset_tag: string | null }>
	cables: SearchGroup<{ id: number; label: string | null; kind: string | null }>
}

const GROUP_LIMIT = 10

function groupOf<T>(items: T[]): SearchGroup<T> {
	return { items, total: items.length }
}

/**
 * Cross-entity substring search over name/slug/asset_tag/label columns.
 * Tenants are documentation labels only, so one flat query spans every
 * group — no row-level isolation applies. Each group caps at 10 hits;
 * an empty query returns empty groups instead of the whole inventory.
 *
 * `scopeTenantId` limits scoped editors/viewers to their tenant, strictly:
 * the tenants group returns only the scope tenant, the sites/racks/devices
 * groups return scope rows only (shared `NULL` rows excluded), and the
 * cables group returns only cables whose both endpoint devices sit in the
 * scope (so no peer name from another tenant leaks).
 */
export async function globalSearch(
	q: string,
	scopeTenantId?: number,
): Promise<GlobalSearchResponse> {
	const query = q.trim()
	if (!query) {
		return {
			q: '',
			tenants: groupOf([]),
			sites: groupOf([]),
			racks: groupOf([]),
			devices: groupOf([]),
			cables: groupOf([]),
		}
	}
	const db = getDb()
	const inScope = (column: PgColumn): SQL | undefined =>
		scopeTenantId === undefined ? undefined : eq(column, scopeTenantId)

	const tenantRows = await db
		.select({ id: tenants.id, name: tenants.name })
		.from(tenants)
		.where(
			and(
				searchCondition(query, [tenants.name, tenants.customer_number]),
				inScope(tenants.id),
			),
		)
		.orderBy(asc(tenants.name), asc(tenants.id))
		.limit(GROUP_LIMIT)
	const siteRows = await db
		.select({ id: sites.id, name: sites.name })
		.from(sites)
		.where(and(searchCondition(query, [sites.name]), inScope(sites.tenant_id)))
		.orderBy(asc(sites.name), asc(sites.id))
		.limit(GROUP_LIMIT)
	const rackRows = await db
		.select({ id: racks.id, name: racks.name })
		.from(racks)
		.where(and(searchCondition(query, [racks.name]), inScope(racks.tenant_id)))
		.orderBy(asc(racks.name), asc(racks.id))
		.limit(GROUP_LIMIT)
	const deviceRows = await db
		.select({ id: devices.id, name: devices.name, asset_tag: devices.asset_tag })
		.from(devices)
		.where(
			and(
				searchCondition(query, [
					devices.name,
					devices.asset_tag,
					devices.device_id,
					devices.serial,
				]),
				inScope(devices.tenant_id),
			),
		)
		.orderBy(asc(devices.name), asc(devices.id))
		.limit(GROUP_LIMIT)
	const cableRows = await db
		.select({ id: cables.id, label: cables.label, kind: cables.kind })
		.from(cables)
		.where(
			and(
				searchCondition(query, [cables.label, cables.kind]),
				scopeTenantId === undefined ? undefined : cableInTenant(scopeTenantId),
			),
		)
		.orderBy(asc(cables.id))
		.limit(GROUP_LIMIT)

	return {
		q: query,
		tenants: groupOf(tenantRows),
		sites: groupOf(siteRows),
		racks: groupOf(rackRows),
		devices: groupOf(deviceRows),
		cables: groupOf(cableRows),
	}
}
