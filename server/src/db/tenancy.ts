import { Result } from 'better-result'
import { and, asc, count, desc, eq, inArray, isNull, type SQL, sql } from 'drizzle-orm'
import {
	type LocationCreate,
	type LocationUpdate,
	MAX_LOCATION_DEPTH,
	type SiteCreate,
	type SiteUpdate,
	type TenantCreate,
	type TenantUpdate,
} from 'shared/src/schemas'
import { devices, locations, racks, sites, tenants } from '../schema'
import {
	buildChildrenMap,
	buildParentMap,
	createsCycle,
	depthOf,
	maxDescendantOffset,
} from '../services/hierarchy'
import { getDb } from './connection'
import { ConflictError, DuplicateError, isUniqueViolation, NotFoundError } from './errors'

export type TenantRow = typeof tenants.$inferSelect
export type SiteRow = typeof sites.$inferSelect
export type LocationRow = typeof locations.$inferSelect

export interface Page<T> {
	items: T[]
	total: number
	page: number
	limit: number
}

export interface ListParams {
	search: string
	page: number
	limit: number
}

export interface TenantListParams extends ListParams {
	sort: 'name' | 'slug' | 'description'
	order: 'asc' | 'desc'
}

/** One tenant row for the list view, with NetBox-style related-object counts. */
export interface TenantListItem extends TenantRow {
	site_count: number
	rack_count: number
	device_count: number
}

function pageOf<T>(items: T[], total: number, params: ListParams): Page<T> {
	return { items, total, page: params.page, limit: params.limit }
}

function offsetOf(params: ListParams): number {
	return (params.page - 1) * params.limit
}

/** LIKE pattern with `%`, `_` and `\` escaped so the search stays literal. */
function searchPattern(raw: string): string {
	return `%${raw.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')}%`
}

// ---------------------------------------------------------------------------
// Tenants
// ---------------------------------------------------------------------------

export function listTenants(params: TenantListParams): Page<TenantListItem> {
	const db = getDb()
	const pattern = searchPattern(params.search)
	const where = params.search
		? sql`(${tenants.name} LIKE ${pattern} ESCAPE '\\' OR ${tenants.slug} LIKE ${pattern} ESCAPE '\\' OR ${tenants.description} LIKE ${pattern} ESCAPE '\\')`
		: undefined
	const orderColumn =
		params.sort === 'slug'
			? tenants.slug
			: params.sort === 'description'
				? tenants.description
				: tenants.name
	const items = db
		.select()
		.from(tenants)
		.where(where)
		.orderBy(params.order === 'desc' ? desc(orderColumn) : asc(orderColumn))
		.limit(params.limit)
		.offset(offsetOf(params))
		.all()
	const totalRow = db.select({ n: count() }).from(tenants).where(where).get()
	const total = totalRow?.n ?? 0

	// NetBox-style related-object counts for the list view. One grouped
	// query per table keeps this O(1) queries instead of O(page size).
	const counts = new Map<number, { sites: number; racks: number; devices: number }>()
	for (const t of items) {
		counts.set(t.id, { sites: 0, racks: 0, devices: 0 })
	}
	if (items.length > 0) {
		const ids = items.map((t) => t.id)
		const apply = (
			tenantId: number | null,
			key: 'sites' | 'racks' | 'devices',
			n: number,
		): void => {
			if (tenantId === null) {
				return
			}
			const entry = counts.get(tenantId)
			if (entry) {
				entry[key] = n
			}
		}
		for (const row of db
			.select({ tenant_id: sites.tenant_id, n: count() })
			.from(sites)
			.where(inArray(sites.tenant_id, ids))
			.groupBy(sites.tenant_id)
			.all()) {
			apply(row.tenant_id, 'sites', row.n)
		}
		for (const row of db
			.select({ tenant_id: racks.tenant_id, n: count() })
			.from(racks)
			.where(inArray(racks.tenant_id, ids))
			.groupBy(racks.tenant_id)
			.all()) {
			apply(row.tenant_id, 'racks', row.n)
		}
		for (const row of db
			.select({ tenant_id: devices.tenant_id, n: count() })
			.from(devices)
			.where(inArray(devices.tenant_id, ids))
			.groupBy(devices.tenant_id)
			.all()) {
			apply(row.tenant_id, 'devices', row.n)
		}
	}

	return pageOf(
		items.map((t) => ({
			...t,
			site_count: counts.get(t.id)?.sites ?? 0,
			rack_count: counts.get(t.id)?.racks ?? 0,
			device_count: counts.get(t.id)?.devices ?? 0,
		})),
		total,
		params,
	)
}

export function getTenant(id: number): Result<TenantRow, Error> {
	const row = getDb().select().from(tenants).where(eq(tenants.id, id)).get()
	if (!row) {
		return Result.err(new NotFoundError('Tenant not found'))
	}
	return Result.ok(row)
}

export function createTenant(input: TenantCreate): Result<TenantRow, Error> {
	const db = getDb()
	const clash = db.select().from(tenants).where(eq(tenants.slug, input.slug)).get()
	if (clash) {
		return Result.err(new DuplicateError('Tenant slug is already in use'))
	}
	const row: Omit<TenantRow, 'id'> = {
		name: input.name,
		slug: input.slug,
		description: input.description ?? null,
		comments: input.comments ?? null,
	}
	try {
		const inserted = db.insert(tenants).values(row).returning({ id: tenants.id }).get()
		if (!inserted) {
			return Result.err(new Error('Tenant insert did not return an id'))
		}
		return getTenant(inserted.id)
	} catch (err) {
		if (isUniqueViolation(err)) {
			return Result.err(new DuplicateError('Tenant slug is already in use'))
		}
		return Result.err(err instanceof Error ? err : new Error(String(err)))
	}
}

export function updateTenant(id: number, input: TenantUpdate): Result<TenantRow, Error> {
	const current = getTenant(id)
	if (Result.isError(current)) {
		return current
	}
	const db = getDb()
	if (input.slug !== undefined && input.slug !== current.value.slug) {
		const clash = db.select().from(tenants).where(eq(tenants.slug, input.slug)).get()
		if (clash) {
			return Result.err(new DuplicateError('Tenant slug is already in use'))
		}
	}
	const patch: Partial<TenantRow> = {}
	if (input.name !== undefined) {
		patch.name = input.name
	}
	if (input.slug !== undefined) {
		patch.slug = input.slug
	}
	if (input.description !== undefined) {
		patch.description = input.description
	}
	if (input.comments !== undefined) {
		patch.comments = input.comments
	}
	if (Object.keys(patch).length > 0) {
		try {
			db.update(tenants).set(patch).where(eq(tenants.id, id)).run()
		} catch (err) {
			if (isUniqueViolation(err)) {
				return Result.err(new DuplicateError('Tenant slug is already in use'))
			}
			return Result.err(err instanceof Error ? err : new Error(String(err)))
		}
	}
	return getTenant(id)
}

export function deleteTenant(id: number): Result<TenantRow, Error> {
	const current = getTenant(id)
	if (Result.isError(current)) {
		return current
	}
	const db = getDb()
	const siteChild = db.select().from(sites).where(eq(sites.tenant_id, id)).get()
	if (siteChild) {
		return Result.err(new ConflictError('Tenant still has sites; move or delete them first'))
	}
	const rackChild = db.select().from(racks).where(eq(racks.tenant_id, id)).get()
	if (rackChild) {
		return Result.err(new ConflictError('Tenant still has racks; move or delete them first'))
	}
	db.delete(tenants).where(eq(tenants.id, id)).run()
	return Result.ok(current.value)
}

// ---------------------------------------------------------------------------
// Sites
// ---------------------------------------------------------------------------

export interface SiteListParams extends ListParams {
	tenant?: number
}

export function listSites(params: SiteListParams): Page<SiteRow> {
	const db = getDb()
	const pattern = searchPattern(params.search)
	const conditions: SQL[] = []
	if (params.search) {
		conditions.push(
			sql`(${sites.name} LIKE ${pattern} ESCAPE '\\' OR ${sites.slug} LIKE ${pattern} ESCAPE '\\')`,
		)
	}
	if (params.tenant) {
		conditions.push(eq(sites.tenant_id, params.tenant))
	}
	const where = conditions.length > 0 ? and(...conditions) : undefined
	const items = db
		.select()
		.from(sites)
		.where(where)
		.orderBy(asc(sites.name))
		.limit(params.limit)
		.offset(offsetOf(params))
		.all()
	const totalRow = db.select({ n: count() }).from(sites).where(where).get()
	return pageOf(items, totalRow?.n ?? 0, params)
}

export function getSite(id: number): Result<SiteRow, Error> {
	const row = getDb().select().from(sites).where(eq(sites.id, id)).get()
	if (!row) {
		return Result.err(new NotFoundError('Site not found'))
	}
	return Result.ok(row)
}

function checkTenant(tenantId: number | null | undefined): Result<undefined, Error> {
	if (tenantId === null || tenantId === undefined) {
		return Result.ok(undefined)
	}
	const tenant = getDb().select().from(tenants).where(eq(tenants.id, tenantId)).get()
	if (!tenant) {
		return Result.err(new NotFoundError('Tenant not found'))
	}
	return Result.ok(undefined)
}

export function createSite(input: SiteCreate): Result<SiteRow, Error> {
	const tenantCheck = checkTenant(input.tenant_id)
	if (Result.isError(tenantCheck)) {
		return Result.err(tenantCheck.error)
	}
	const db = getDb()
	const clash = db.select().from(sites).where(eq(sites.slug, input.slug)).get()
	if (clash) {
		return Result.err(new DuplicateError('Site slug is already in use'))
	}
	const row: Omit<SiteRow, 'id'> = {
		tenant_id: input.tenant_id ?? null,
		name: input.name,
		slug: input.slug,
		group: input.group ?? null,
		description: input.description ?? null,
	}
	try {
		const inserted = db.insert(sites).values(row).returning({ id: sites.id }).get()
		if (!inserted) {
			return Result.err(new Error('Site insert did not return an id'))
		}
		return getSite(inserted.id)
	} catch (err) {
		if (isUniqueViolation(err)) {
			return Result.err(new DuplicateError('Site slug is already in use'))
		}
		return Result.err(err instanceof Error ? err : new Error(String(err)))
	}
}

export function updateSite(id: number, input: SiteUpdate): Result<SiteRow, Error> {
	const current = getSite(id)
	if (Result.isError(current)) {
		return current
	}
	if (input.tenant_id !== undefined) {
		const tenantCheck = checkTenant(input.tenant_id)
		if (Result.isError(tenantCheck)) {
			return Result.err(tenantCheck.error)
		}
	}
	const db = getDb()
	if (input.slug !== undefined && input.slug !== current.value.slug) {
		const clash = db.select().from(sites).where(eq(sites.slug, input.slug)).get()
		if (clash) {
			return Result.err(new DuplicateError('Site slug is already in use'))
		}
	}
	const patch: Partial<SiteRow> = {}
	if (input.name !== undefined) {
		patch.name = input.name
	}
	if (input.slug !== undefined) {
		patch.slug = input.slug
	}
	if (input.tenant_id !== undefined) {
		patch.tenant_id = input.tenant_id
	}
	if (input.group !== undefined) {
		patch.group = input.group
	}
	if (input.description !== undefined) {
		patch.description = input.description
	}
	if (Object.keys(patch).length > 0) {
		try {
			db.update(sites).set(patch).where(eq(sites.id, id)).run()
		} catch (err) {
			if (isUniqueViolation(err)) {
				return Result.err(new DuplicateError('Site slug is already in use'))
			}
			return Result.err(err instanceof Error ? err : new Error(String(err)))
		}
	}
	return getSite(id)
}

export function deleteSite(id: number): Result<SiteRow, Error> {
	const current = getSite(id)
	if (Result.isError(current)) {
		return current
	}
	const child = getDb().select().from(locations).where(eq(locations.site_id, id)).get()
	if (child) {
		return Result.err(new ConflictError('Site still has locations; move or delete them first'))
	}
	const rackChild = getDb().select().from(racks).where(eq(racks.site_id, id)).get()
	if (rackChild) {
		return Result.err(new ConflictError('Site still has racks; move or delete them first'))
	}
	getDb().delete(sites).where(eq(sites.id, id)).run()
	return Result.ok(current.value)
}

// ---------------------------------------------------------------------------
// Locations
// ---------------------------------------------------------------------------

export interface LocationListParams extends ListParams {
	site?: number
	tenant?: number
	parent?: number
}

export function listLocations(params: LocationListParams): Page<LocationRow> {
	const db = getDb()
	const pattern = searchPattern(params.search)
	const conditions: SQL[] = []
	if (params.search) {
		conditions.push(
			sql`(${locations.name} LIKE ${pattern} ESCAPE '\\' OR ${locations.slug} LIKE ${pattern} ESCAPE '\\')`,
		)
	}
	if (params.site) {
		conditions.push(eq(locations.site_id, params.site))
	}
	if (params.tenant) {
		conditions.push(eq(locations.tenant_id, params.tenant))
	}
	if (params.parent) {
		conditions.push(eq(locations.parent_id, params.parent))
	}
	const where = conditions.length > 0 ? and(...conditions) : undefined
	const items = db
		.select()
		.from(locations)
		.where(where)
		.orderBy(asc(locations.name))
		.limit(params.limit)
		.offset(offsetOf(params))
		.all()
	const totalRow = db.select({ n: count() }).from(locations).where(where).get()
	return pageOf(items, totalRow?.n ?? 0, params)
}

export function getLocation(id: number): Result<LocationRow, Error> {
	const row = getDb().select().from(locations).where(eq(locations.id, id)).get()
	if (!row) {
		return Result.err(new NotFoundError('Location not found'))
	}
	return Result.ok(row)
}

function siblingSlugClash(
	siteId: number,
	parentId: number | null,
	slug: string,
	excludeId?: number,
): boolean {
	const db = getDb()
	const parentCond =
		parentId === null ? isNull(locations.parent_id) : eq(locations.parent_id, parentId)
	const clash = db
		.select()
		.from(locations)
		.where(and(eq(locations.site_id, siteId), parentCond, eq(locations.slug, slug)))
		.get()
	return !!clash && clash.id !== excludeId
}

/** Parent links of every location in a site, for depth/cycle checks. */
function siteParentMap(siteId: number): Map<number, number | null> {
	const rows = getDb()
		.select({ id: locations.id, parent_id: locations.parent_id })
		.from(locations)
		.where(eq(locations.site_id, siteId))
		.all()
	return buildParentMap(rows)
}

export function createLocation(input: LocationCreate): Result<LocationRow, Error> {
	const db = getDb()
	const site = db.select().from(sites).where(eq(sites.id, input.site_id)).get()
	if (!site) {
		return Result.err(new NotFoundError('Site not found'))
	}
	const tenantCheck = checkTenant(input.tenant_id)
	if (Result.isError(tenantCheck)) {
		return Result.err(tenantCheck.error)
	}
	const parentId = input.parent_id ?? null
	const parents = siteParentMap(input.site_id)
	if (parentId !== null) {
		if (!parents.has(parentId)) {
			return Result.err(new NotFoundError('Parent location not found in this site'))
		}
		const parentDepth = depthOf(parentId, parents)
		if (Result.isError(parentDepth)) {
			return Result.err(new ConflictError(parentDepth.error.message))
		}
		if (parentDepth.value + 1 > MAX_LOCATION_DEPTH) {
			return Result.err(
				new ConflictError(`Location hierarchy is limited to ${MAX_LOCATION_DEPTH} levels`),
			)
		}
	}
	if (siblingSlugClash(input.site_id, parentId, input.slug)) {
		return Result.err(new DuplicateError('Location slug is already used under this parent'))
	}
	const row: Omit<LocationRow, 'id'> = {
		site_id: input.site_id,
		parent_id: parentId,
		tenant_id: input.tenant_id ?? null,
		name: input.name,
		slug: input.slug,
		description: input.description ?? null,
	}
	try {
		const inserted = db.insert(locations).values(row).returning({ id: locations.id }).get()
		if (!inserted) {
			return Result.err(new Error('Location insert did not return an id'))
		}
		return getLocation(inserted.id)
	} catch (err) {
		if (isUniqueViolation(err)) {
			return Result.err(new DuplicateError('Location slug is already used under this parent'))
		}
		return Result.err(err instanceof Error ? err : new Error(String(err)))
	}
}

export function updateLocation(id: number, input: LocationUpdate): Result<LocationRow, Error> {
	const current = getLocation(id)
	if (Result.isError(current)) {
		return current
	}
	const node = current.value
	if (input.tenant_id !== undefined) {
		const tenantCheck = checkTenant(input.tenant_id)
		if (Result.isError(tenantCheck)) {
			return Result.err(tenantCheck.error)
		}
	}
	const effectiveParent = input.parent_id !== undefined ? input.parent_id : node.parent_id
	const effectiveSlug = input.slug !== undefined ? input.slug : node.slug

	if (effectiveParent !== undefined && effectiveParent !== null) {
		const parents = siteParentMap(node.site_id)
		if (!parents.has(effectiveParent)) {
			return Result.err(new NotFoundError('Parent location not found in this site'))
		}
		if (effectiveParent === id || createsCycle(id, effectiveParent, parents)) {
			return Result.err(
				new ConflictError('Cannot set a location as its own parent or descendant'),
			)
		}
		const parentDepth = depthOf(effectiveParent, parents)
		if (Result.isError(parentDepth)) {
			return Result.err(new ConflictError(parentDepth.error.message))
		}
		const rows = getDb()
			.select({ id: locations.id, parent_id: locations.parent_id })
			.from(locations)
			.where(eq(locations.site_id, node.site_id))
			.all()
		const subtreeGrowth = maxDescendantOffset(id, buildChildrenMap(rows))
		if (parentDepth.value + 1 + subtreeGrowth > MAX_LOCATION_DEPTH) {
			return Result.err(
				new ConflictError(`Location hierarchy is limited to ${MAX_LOCATION_DEPTH} levels`),
			)
		}
	}
	if (siblingSlugClash(node.site_id, effectiveParent ?? null, effectiveSlug, id)) {
		return Result.err(new DuplicateError('Location slug is already used under this parent'))
	}
	const patch: Partial<LocationRow> = {}
	if (input.name !== undefined) {
		patch.name = input.name
	}
	if (input.slug !== undefined) {
		patch.slug = input.slug
	}
	if (input.parent_id !== undefined) {
		patch.parent_id = input.parent_id
	}
	if (input.tenant_id !== undefined) {
		patch.tenant_id = input.tenant_id
	}
	if (input.description !== undefined) {
		patch.description = input.description
	}
	if (Object.keys(patch).length > 0) {
		try {
			getDb().update(locations).set(patch).where(eq(locations.id, id)).run()
		} catch (err) {
			if (isUniqueViolation(err)) {
				return Result.err(
					new DuplicateError('Location slug is already used under this parent'),
				)
			}
			return Result.err(err instanceof Error ? err : new Error(String(err)))
		}
	}
	return getLocation(id)
}

export function deleteLocation(id: number): Result<LocationRow, Error> {
	const current = getLocation(id)
	if (Result.isError(current)) {
		return current
	}
	const child = getDb().select().from(locations).where(eq(locations.parent_id, id)).get()
	if (child) {
		return Result.err(
			new ConflictError('Location still has child locations; move or delete them first'),
		)
	}
	const rackChild = getDb().select().from(racks).where(eq(racks.location_id, id)).get()
	if (rackChild) {
		return Result.err(new ConflictError('Location still has racks; move or delete them first'))
	}
	getDb().delete(locations).where(eq(locations.id, id)).run()
	return Result.ok(current.value)
}
