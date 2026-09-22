import { asc, sql } from 'drizzle-orm'
import { getDb } from './connection'

export interface SearchGroup<T> {
	items: T[]
	total: number
}

export interface GlobalSearchResponse {
	q: string
	tenants: SearchGroup<{ id: number; name: string; slug: string }>
	sites: SearchGroup<{ id: number; name: string; slug: string }>
	racks: SearchGroup<{ id: number; name: string }>
	devices: SearchGroup<{ id: number; name: string; asset_tag: string | null }>
	cables: SearchGroup<{ id: number; label: string | null; kind: string | null }>
}

const GROUP_LIMIT = 10

/** LIKE pattern with `%`, `_` and `\` escaped so the search stays literal. */
function searchPattern(raw: string): string {
	return `%${raw.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')}%`
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
export function globalSearch(q: string, scopeTenantId?: number): GlobalSearchResponse {
	const db = getDb()
	const query = q.trim()
	const empty = <T>(): SearchGroup<T> => ({ items: [], total: 0 })
	if (!query) {
		return {
			q: '',
			tenants: empty(),
			sites: empty(),
			racks: empty(),
			devices: empty(),
			cables: empty(),
		}
	}
	const pattern = searchPattern(query)
	const scope = scopeTenantId

	const tenantRows = db
		.select({ id: sql<number>`id`, name: sql<string>`name`, slug: sql<string>`slug` })
		.from(sql`tenants`)
		.where(
			scope === undefined
				? sql`(name LIKE ${pattern} ESCAPE '\\' OR slug LIKE ${pattern} ESCAPE '\\')`
				: sql`(name LIKE ${pattern} ESCAPE '\\' OR slug LIKE ${pattern} ESCAPE '\\') AND (id = ${scope})`,
		)
		.orderBy(asc(sql`name`))
		.limit(GROUP_LIMIT)
		.all()
	const tenantScope = scope === undefined ? sql`` : sql` AND (tenant_id = ${scope})`
	const siteRows = db
		.select({ id: sql<number>`id`, name: sql<string>`name`, slug: sql<string>`slug` })
		.from(sql`sites`)
		.where(
			sql`(name LIKE ${pattern} ESCAPE '\\' OR slug LIKE ${pattern} ESCAPE '\\')${tenantScope}`,
		)
		.orderBy(asc(sql`name`))
		.limit(GROUP_LIMIT)
		.all()
	const rackRows = db
		.select({ id: sql<number>`id`, name: sql<string>`name` })
		.from(sql`racks`)
		.where(
			sql`name LIKE ${pattern} ESCAPE '\\'${tenantScope}`,
		)
		.orderBy(asc(sql`name`))
		.limit(GROUP_LIMIT)
		.all()
	const deviceRows = db
		.select({
			id: sql<number>`id`,
			name: sql<string>`name`,
			asset_tag: sql<string | null>`asset_tag`,
		})
		.from(sql`devices`)
		.where(
			sql`(name LIKE ${pattern} ESCAPE '\\' OR asset_tag LIKE ${pattern} ESCAPE '\\' OR serial LIKE ${pattern} ESCAPE '\\')${tenantScope}`,
		)
		.orderBy(asc(sql`name`))
		.limit(GROUP_LIMIT)
		.all()
	const cableRows =
		scope === undefined
			? db
					.select({
						id: sql<number>`id`,
						label: sql<string | null>`label`,
						kind: sql<string | null>`kind`,
					})
					.from(sql`cables`)
					.where(
						sql`(label LIKE ${pattern} ESCAPE '\\' OR kind LIKE ${pattern} ESCAPE '\\')`,
					)
					.orderBy(sql`rowid`)
					.limit(GROUP_LIMIT)
					.all()
			: db
					.select({
						id: sql<number>`cables.id`,
						label: sql<string | null>`cables.label`,
						kind: sql<string | null>`cables.kind`,
					})
					.from(sql`cables`)
					.where(
						sql`(cables.label LIKE ${pattern} ESCAPE '\\' OR cables.kind LIKE ${pattern} ESCAPE '\\') AND EXISTS (SELECT 1 FROM interfaces AS search_ia JOIN devices AS search_da ON search_da.id = search_ia.device_id WHERE search_ia.id = cables.a_interface_id AND search_da.tenant_id = ${scope}) AND EXISTS (SELECT 1 FROM interfaces AS search_ib JOIN devices AS search_db ON search_db.id = search_ib.device_id WHERE search_ib.id = cables.b_interface_id AND search_db.tenant_id = ${scope})`,
					)
					.orderBy(sql`cables.rowid`)
					.limit(GROUP_LIMIT)
					.all()

	return {
		q: query,
		tenants: { items: tenantRows, total: tenantRows.length },
		sites: { items: siteRows, total: siteRows.length },
		racks: { items: rackRows, total: rackRows.length },
		devices: { items: deviceRows, total: deviceRows.length },
		cables: { items: cableRows, total: cableRows.length },
	}
}
