import { Result } from 'better-result'
import { and, asc, count, desc, eq, inArray, isNull, type SQL, sql } from 'drizzle-orm'
import {
	type LocationCreate,
	type LocationUpdate,
	MAX_LOCATION_DEPTH,
	MAX_SITE_GROUP_DEPTH,
	type SiteCreate,
	type SiteGroupCreate,
	type SiteGroupUpdate,
	type SiteUpdate,
	type TenantCreate,
	type TenantUpdate,
} from 'shared/src/schemas'
import { devices, locations, racks, site_groups, sites, tenants, users } from '../schema'
import {
	buildChildrenMap,
	buildParentMap,
	createsCycle,
	depthOf,
	maxDescendantOffset,
} from '../services/hierarchy'
import { getDb } from './connection'
import { ConflictError, DuplicateError, isUniqueViolation, NotFoundError } from './errors'
import {
	checkTenantExists,
	errOf,
	isPatchEmpty,
	type ListParams,
	offsetOf,
	type Page,
	pageOf,
	searchPattern,
} from './list'

export type { ListParams, Page } from './list'
export type TenantRow = typeof tenants.$inferSelect
export type SiteRow = typeof sites.$inferSelect
export type SiteGroupRow = typeof site_groups.$inferSelect
export type LocationRow = typeof locations.$inferSelect

export interface TenantListParams extends ListParams {
	sort: 'name' | 'slug' | 'description'
	order: 'asc' | 'desc'
	/**
	 * Tenant scope for scoped editors/viewers: restricts the list to this
	 * tenant only (exact id match — tenants have no shared `NULL` row).
	 * `undefined` means unconstrained (admin or global user).
	 */
	scopeTenantId?: number
}

/** One tenant row for the list view, with NetBox-style related-object counts. */
export interface TenantListItem extends TenantRow {
	site_count: number
	rack_count: number
	device_count: number
}

// ---------------------------------------------------------------------------
// Tenants
// ---------------------------------------------------------------------------

export function listTenants(params: TenantListParams): Page<TenantListItem> {
	const db = getDb()
	const pattern = searchPattern(params.search)
	const conditions: SQL[] = []
	if (params.search) {
		conditions.push(
			sql`(${tenants.name} LIKE ${pattern} ESCAPE '\\' OR ${tenants.slug} LIKE ${pattern} ESCAPE '\\' OR ${tenants.description} LIKE ${pattern} ESCAPE '\\')`,
		)
	}
	if (params.scopeTenantId !== undefined) {
		conditions.push(eq(tenants.id, params.scopeTenantId))
	}
	const where = conditions.length > 0 ? and(...conditions) : undefined
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
	if (!isPatchEmpty(patch)) {
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
	const groupChild = db.select().from(site_groups).where(eq(site_groups.tenant_id, id)).get()
	if (groupChild) {
		return Result.err(
			new ConflictError('Tenant still has site groups; move or delete them first'),
		)
	}
	const rackChild = db.select().from(racks).where(eq(racks.tenant_id, id)).get()
	if (rackChild) {
		return Result.err(new ConflictError('Tenant still has racks; move or delete them first'))
	}
	const deviceChild = db.select().from(devices).where(eq(devices.tenant_id, id)).get()
	if (deviceChild) {
		return Result.err(new ConflictError('Tenant still has devices; move or delete them first'))
	}
	const userChild = db.select().from(users).where(eq(users.tenant_id, id)).get()
	if (userChild) {
		return Result.err(
			new ConflictError('Tenant still has users; reassign them before deleting'),
		)
	}
	try {
		db.delete(tenants).where(eq(tenants.id, id)).run()
	} catch (e) {
		return Result.err(errOf(e))
	}
	return Result.ok(current.value)
}

// ---------------------------------------------------------------------------
// Sites
// ---------------------------------------------------------------------------

export interface SiteListParams extends ListParams {
	tenant?: number
	group?: number
	sort: 'name' | 'slug' | 'description'
	order: 'asc' | 'desc'
	/**
	 * Tenant scope for scoped editors/viewers: restricts the list to this
	 * tenant only (strict — shared `NULL` rows are excluded).
	 * `undefined` means unconstrained (admin or global user). The route
	 * rejects an explicit `?tenant=` naming any other tenant before this is
	 * applied.
	 */
	scopeTenantId?: number
}

export function listSites(params: SiteListParams): Page<SiteRow> {
	const db = getDb()
	const pattern = searchPattern(params.search)
	const conditions: SQL[] = []
	if (params.search) {
		conditions.push(
			sql`(${sites.name} LIKE ${pattern} ESCAPE '\\' OR ${sites.slug} LIKE ${pattern} ESCAPE '\\' OR ${sites.description} LIKE ${pattern} ESCAPE '\\')`,
		)
	}
	if (params.tenant) {
		conditions.push(eq(sites.tenant_id, params.tenant))
	}
	if (params.group) {
		conditions.push(eq(sites.site_group_id, params.group))
	}
	if (params.scopeTenantId !== undefined) {
		conditions.push(eq(sites.tenant_id, params.scopeTenantId))
	}
	const where = conditions.length > 0 ? and(...conditions) : undefined
	const orderColumn =
		params.sort === 'slug'
			? sites.slug
			: params.sort === 'description'
				? sites.description
				: sites.name
	const items = db
		.select()
		.from(sites)
		.where(where)
		.orderBy(params.order === 'desc' ? desc(orderColumn) : asc(orderColumn))
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

function checkSiteGroup(groupId: number | null | undefined): Result<undefined, Error> {
	if (groupId === null || groupId === undefined) {
		return Result.ok(undefined)
	}
	const group = getDb().select().from(site_groups).where(eq(site_groups.id, groupId)).get()
	if (!group) {
		return Result.err(new NotFoundError('Site group not found'))
	}
	return Result.ok(undefined)
}

export function createSite(input: SiteCreate): Result<SiteRow, Error> {
	const tenantCheck = checkTenantExists(input.tenant_id)
	if (Result.isError(tenantCheck)) {
		return Result.err(tenantCheck.error)
	}
	const groupCheck = checkSiteGroup(input.site_group_id)
	if (Result.isError(groupCheck)) {
		return Result.err(groupCheck.error)
	}
	const db = getDb()
	const clash = db.select().from(sites).where(eq(sites.slug, input.slug)).get()
	if (clash) {
		return Result.err(new DuplicateError('Site slug is already in use'))
	}
	const row: Omit<SiteRow, 'id'> = {
		tenant_id: input.tenant_id ?? null,
		site_group_id: input.site_group_id ?? null,
		name: input.name,
		slug: input.slug,
		description: input.description ?? null,
		comments: input.comments ?? null,
		physical_address: input.physical_address ?? null,
		shipping_address: input.shipping_address ?? null,
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
		const tenantCheck = checkTenantExists(input.tenant_id)
		if (Result.isError(tenantCheck)) {
			return Result.err(tenantCheck.error)
		}
	}
	if (input.site_group_id !== undefined) {
		const groupCheck = checkSiteGroup(input.site_group_id)
		if (Result.isError(groupCheck)) {
			return Result.err(groupCheck.error)
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
	if (input.site_group_id !== undefined) {
		patch.site_group_id = input.site_group_id
	}
	if (input.description !== undefined) {
		patch.description = input.description
	}
	if (input.comments !== undefined) {
		patch.comments = input.comments
	}
	if (input.physical_address !== undefined) {
		patch.physical_address = input.physical_address
	}
	if (input.shipping_address !== undefined) {
		patch.shipping_address = input.shipping_address
	}
	if (!isPatchEmpty(patch)) {
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
	try {
		getDb().delete(sites).where(eq(sites.id, id)).run()
	} catch (e) {
		return Result.err(errOf(e))
	}
	return Result.ok(current.value)
}

// ---------------------------------------------------------------------------
// Site groups (global nestable tree, no site scoping)
// ---------------------------------------------------------------------------

export interface SiteGroupListParams extends ListParams {
	tenant?: number
	parent?: number
	sort: 'name' | 'slug' | 'description'
	order: 'asc' | 'desc'
	/** Tenant scope (own tenant only, strict); `undefined` = unconstrained. */
	scopeTenantId?: number
}

export function listSiteGroups(params: SiteGroupListParams): Page<SiteGroupRow> {
	const db = getDb()
	const pattern = searchPattern(params.search)
	const conditions: SQL[] = []
	if (params.search) {
		conditions.push(
			sql`(${site_groups.name} LIKE ${pattern} ESCAPE '\\' OR ${site_groups.slug} LIKE ${pattern} ESCAPE '\\')`,
		)
	}
	if (params.tenant) {
		conditions.push(eq(site_groups.tenant_id, params.tenant))
	}
	if (params.parent) {
		conditions.push(eq(site_groups.parent_id, params.parent))
	}
	if (params.scopeTenantId !== undefined) {
		conditions.push(eq(site_groups.tenant_id, params.scopeTenantId))
	}
	const where = conditions.length > 0 ? and(...conditions) : undefined
	const orderColumn =
		params.sort === 'slug'
			? site_groups.slug
			: params.sort === 'description'
				? site_groups.description
				: site_groups.name
	const items = db
		.select()
		.from(site_groups)
		.where(where)
		.orderBy(params.order === 'desc' ? desc(orderColumn) : asc(orderColumn))
		.limit(params.limit)
		.offset(offsetOf(params))
		.all()
	const totalRow = db.select({ n: count() }).from(site_groups).where(where).get()
	return pageOf(items, totalRow?.n ?? 0, params)
}

export function getSiteGroup(id: number): Result<SiteGroupRow, Error> {
	const row = getDb().select().from(site_groups).where(eq(site_groups.id, id)).get()
	if (!row) {
		return Result.err(new NotFoundError('Site group not found'))
	}
	return Result.ok(row)
}

function slugUnderParentClash(
	table: typeof site_groups | typeof locations,
	parentCol: typeof site_groups.parent_id | typeof locations.parent_id,
	slugCol: typeof site_groups.slug | typeof locations.slug,
	parentId: number | null,
	slug: string,
	excludeId?: number,
	extra?: SQL,
): boolean {
	const parentCond = parentId === null ? isNull(parentCol) : eq(parentCol, parentId)
	const conds = extra ? [parentCond, eq(slugCol, slug), extra] : [parentCond, eq(slugCol, slug)]
	const clash = getDb()
		.select()
		// biome-ignore lint/suspicious/noExplicitAny: generic over two tables with identical columns
		.from(table as any)
		.where(and(...conds))
		.get() as { id: number } | undefined
	return !!clash && clash.id !== excludeId
}

function groupSlugClash(parentId: number | null, slug: string, excludeId?: number): boolean {
	return slugUnderParentClash(
		site_groups,
		site_groups.parent_id,
		site_groups.slug,
		parentId,
		slug,
		excludeId,
	)
}

/** Parent links of every site group, for depth/cycle checks. */
function groupParentMap(): Map<number, number | null> {
	const rows = getDb()
		.select({ id: site_groups.id, parent_id: site_groups.parent_id })
		.from(site_groups)
		.all()
	return buildParentMap(rows)
}

export function createSiteGroup(input: SiteGroupCreate): Result<SiteGroupRow, Error> {
	const tenantCheck = checkTenantExists(input.tenant_id)
	if (Result.isError(tenantCheck)) {
		return Result.err(tenantCheck.error)
	}
	const parentId = input.parent_id ?? null
	const parents = groupParentMap()
	if (parentId !== null) {
		if (!parents.has(parentId)) {
			return Result.err(new NotFoundError('Parent site group not found'))
		}
		const parentDepth = depthOf(parentId, parents)
		if (Result.isError(parentDepth)) {
			return Result.err(new ConflictError(parentDepth.error.message))
		}
		if (parentDepth.value + 1 > MAX_SITE_GROUP_DEPTH) {
			return Result.err(
				new ConflictError(
					`Site group hierarchy is limited to ${MAX_SITE_GROUP_DEPTH} levels`,
				),
			)
		}
	}
	if (groupSlugClash(parentId, input.slug)) {
		return Result.err(new DuplicateError('Site group slug is already used under this parent'))
	}
	const row: Omit<SiteGroupRow, 'id'> = {
		tenant_id: input.tenant_id ?? null,
		parent_id: parentId,
		name: input.name,
		slug: input.slug,
		description: input.description ?? null,
		comments: input.comments ?? null,
	}
	try {
		const inserted = getDb()
			.insert(site_groups)
			.values(row)
			.returning({ id: site_groups.id })
			.get()
		if (!inserted) {
			return Result.err(new Error('Site group insert did not return an id'))
		}
		return getSiteGroup(inserted.id)
	} catch (err) {
		if (isUniqueViolation(err)) {
			return Result.err(
				new DuplicateError('Site group slug is already used under this parent'),
			)
		}
		return Result.err(err instanceof Error ? err : new Error(String(err)))
	}
}

export function updateSiteGroup(id: number, input: SiteGroupUpdate): Result<SiteGroupRow, Error> {
	const current = getSiteGroup(id)
	if (Result.isError(current)) {
		return current
	}
	if (input.tenant_id !== undefined) {
		const tenantCheck = checkTenantExists(input.tenant_id)
		if (Result.isError(tenantCheck)) {
			return Result.err(tenantCheck.error)
		}
	}
	const node = current.value
	const effectiveParent = input.parent_id !== undefined ? input.parent_id : node.parent_id
	const effectiveSlug = input.slug !== undefined ? input.slug : node.slug

	if (effectiveParent !== undefined && effectiveParent !== null) {
		const parents = groupParentMap()
		if (!parents.has(effectiveParent)) {
			return Result.err(new NotFoundError('Parent site group not found'))
		}
		if (effectiveParent === id || createsCycle(id, effectiveParent, parents)) {
			return Result.err(
				new ConflictError('Cannot set a site group as its own parent or descendant'),
			)
		}
		const parentDepth = depthOf(effectiveParent, parents)
		if (Result.isError(parentDepth)) {
			return Result.err(new ConflictError(parentDepth.error.message))
		}
		const rows = getDb()
			.select({ id: site_groups.id, parent_id: site_groups.parent_id })
			.from(site_groups)
			.all()
		const subtreeGrowth = maxDescendantOffset(id, buildChildrenMap(rows))
		if (parentDepth.value + 1 + subtreeGrowth > MAX_SITE_GROUP_DEPTH) {
			return Result.err(
				new ConflictError(
					`Site group hierarchy is limited to ${MAX_SITE_GROUP_DEPTH} levels`,
				),
			)
		}
	}
	if (groupSlugClash(effectiveParent ?? null, effectiveSlug, id)) {
		return Result.err(new DuplicateError('Site group slug is already used under this parent'))
	}
	const patch: Partial<SiteGroupRow> = {}
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
	if (input.comments !== undefined) {
		patch.comments = input.comments
	}
	if (!isPatchEmpty(patch)) {
		try {
			getDb().update(site_groups).set(patch).where(eq(site_groups.id, id)).run()
		} catch (err) {
			if (isUniqueViolation(err)) {
				return Result.err(
					new DuplicateError('Site group slug is already used under this parent'),
				)
			}
			return Result.err(err instanceof Error ? err : new Error(String(err)))
		}
	}
	return getSiteGroup(id)
}

export function deleteSiteGroup(id: number): Result<SiteGroupRow, Error> {
	const current = getSiteGroup(id)
	if (Result.isError(current)) {
		return current
	}
	const db = getDb()
	const child = db.select().from(site_groups).where(eq(site_groups.parent_id, id)).get()
	if (child) {
		return Result.err(
			new ConflictError('Site group still has child groups; move or delete them first'),
		)
	}
	const siteChild = db.select().from(sites).where(eq(sites.site_group_id, id)).get()
	if (siteChild) {
		return Result.err(
			new ConflictError('Site group still has sites; move or delete them first'),
		)
	}
	try {
		db.delete(site_groups).where(eq(site_groups.id, id)).run()
	} catch (e) {
		return Result.err(errOf(e))
	}
	return Result.ok(current.value)
}

// ---------------------------------------------------------------------------
// Locations
// ---------------------------------------------------------------------------

export interface LocationListParams extends ListParams {
	site?: number
	tenant?: number
	parent?: number
	sort: 'name' | 'slug' | 'description'
	order: 'asc' | 'desc'
	/** Tenant scope (own tenant only, strict); `undefined` = unconstrained. */
	scopeTenantId?: number
}

/**
 * Sort locations as a preorder tree: roots and each sibling group are sorted
 * by the requested field, while every parent stays immediately before its
 * descendants. This keeps the API order aligned with the indented list view.
 */
function sortLocationsHierarchically(
	rows: LocationRow[],
	sort: LocationListParams['sort'],
	order: LocationListParams['order'],
): LocationRow[] {
	const children = new Map<number | null, LocationRow[]>()
	const included = new Set(rows.map((row) => row.id))
	for (const row of rows) {
		// A filtered result may omit a row's parent; treat that row as a root in
		// the returned subset rather than hiding it from the tree.
		const parentId =
			row.parent_id !== null && included.has(row.parent_id) ? row.parent_id : null
		const siblings = children.get(parentId)
		if (siblings) {
			siblings.push(row)
		} else {
			children.set(parentId, [row])
		}
	}

	const sortValueOf = (row: LocationRow): string => {
		const value = row[sort]
		return value === null ? '' : String(value)
	}
	const direction = order === 'desc' ? -1 : 1
	const compare = (a: LocationRow, b: LocationRow): number => {
		const byField = sortValueOf(a).localeCompare(sortValueOf(b), undefined, {
			numeric: true,
			sensitivity: 'base',
		})
		if (byField !== 0) {
			return byField * direction
		}
		// Stable tie-breakers make pagination deterministic when sibling values
		// are equal (and match the selected direction for the name tie-breaker).
		const byName = a.name.localeCompare(b.name, undefined, {
			numeric: true,
			sensitivity: 'base',
		})
		return (byName !== 0 ? byName : a.id - b.id) * direction
	}

	const sorted: LocationRow[] = []
	const visit = (parentId: number | null): void => {
		const siblings = children.get(parentId)
		if (!siblings) {
			return
		}
		siblings.sort(compare)
		for (const row of siblings) {
			sorted.push(row)
			visit(row.id)
		}
	}
	visit(null)
	return sorted
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
	if (params.scopeTenantId !== undefined) {
		conditions.push(eq(locations.tenant_id, params.scopeTenantId))
	}
	const where = conditions.length > 0 ? and(...conditions) : undefined
	const matching = db.select().from(locations).where(where).all()
	const ordered = sortLocationsHierarchically(matching, params.sort, params.order)
	const items = ordered.slice(offsetOf(params), offsetOf(params) + params.limit)
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
	return slugUnderParentClash(
		locations,
		locations.parent_id,
		locations.slug,
		parentId,
		slug,
		excludeId,
		eq(locations.site_id, siteId),
	)
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
	const tenantCheck = checkTenantExists(input.tenant_id)
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
		const tenantCheck = checkTenantExists(input.tenant_id)
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
	if (!isPatchEmpty(patch)) {
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
	try {
		getDb().delete(locations).where(eq(locations.id, id)).run()
	} catch (e) {
		return Result.err(errOf(e))
	}
	return Result.ok(current.value)
}
