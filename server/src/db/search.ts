import { asc, sql } from 'drizzle-orm'
import { getDb } from './connection'

export interface SearchGroup<T> {
	items: T[]
	total: number
}

export interface GlobalSearchResponse {
	q: string
	tenants: SearchGroup<{ id: string; name: string; slug: string }>
	sites: SearchGroup<{ id: string; name: string; slug: string }>
	racks: SearchGroup<{ id: string; name: string; slug: string }>
	devices: SearchGroup<{ id: string; name: string; asset_tag: string | null }>
	cables: SearchGroup<{ id: string; label: string | null; kind: string | null }>
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
 */
export function globalSearch(q: string): GlobalSearchResponse {
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

	const tenantRows = db
		.select({ id: sql<string>`id`, name: sql<string>`name`, slug: sql<string>`slug` })
		.from(sql`tenants`)
		.where(sql`(name LIKE ${pattern} ESCAPE '\\' OR slug LIKE ${pattern} ESCAPE '\\')`)
		.orderBy(asc(sql`name`))
		.limit(GROUP_LIMIT)
		.all()
	const siteRows = db
		.select({ id: sql<string>`id`, name: sql<string>`name`, slug: sql<string>`slug` })
		.from(sql`sites`)
		.where(sql`(name LIKE ${pattern} ESCAPE '\\' OR slug LIKE ${pattern} ESCAPE '\\')`)
		.orderBy(asc(sql`name`))
		.limit(GROUP_LIMIT)
		.all()
	const rackRows = db
		.select({ id: sql<string>`id`, name: sql<string>`name`, slug: sql<string>`slug` })
		.from(sql`racks`)
		.where(sql`(name LIKE ${pattern} ESCAPE '\\' OR slug LIKE ${pattern} ESCAPE '\\')`)
		.orderBy(asc(sql`name`))
		.limit(GROUP_LIMIT)
		.all()
	const deviceRows = db
		.select({
			id: sql<string>`id`,
			name: sql<string>`name`,
			asset_tag: sql<string | null>`asset_tag`,
		})
		.from(sql`devices`)
		.where(
			sql`(name LIKE ${pattern} ESCAPE '\\' OR asset_tag LIKE ${pattern} ESCAPE '\\' OR serial LIKE ${pattern} ESCAPE '\\')`,
		)
		.orderBy(asc(sql`name`))
		.limit(GROUP_LIMIT)
		.all()
	const cableRows = db
		.select({
			id: sql<string>`id`,
			label: sql<string | null>`label`,
			kind: sql<string | null>`kind`,
		})
		.from(sql`cables`)
		.where(sql`(label LIKE ${pattern} ESCAPE '\\' OR kind LIKE ${pattern} ESCAPE '\\')`)
		.orderBy(sql`rowid`)
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
