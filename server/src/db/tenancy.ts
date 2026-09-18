import { Result } from 'better-result'
import { and, asc, count, eq, isNull, type SQL, sql } from 'drizzle-orm'
import {
	type LocationCreate,
	type LocationUpdate,
	MAX_LOCATION_DEPTH,
	type SiteCreate,
	type SiteUpdate,
	type TenantCreate,
	type TenantUpdate,
} from 'shared/src/schemas'
import { locations, racks, sites, tenants } from '../schema'
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

function newId(): string {
	return Bun.randomUUIDv7()
}

// ---------------------------------------------------------------------------
// Tenants
// ---------------------------------------------------------------------------

export function listTenants(params: ListParams): Page<TenantRow> {
	const db = getDb()
	const pattern = searchPattern(params.search)
	const where = params.search
		? sql`(${tenants.name} LIKE ${pattern} ESCAPE '\\' OR ${tenants.slug} LIKE ${pattern} ESCAPE '\\')`
		: undefined
	const items = db
		.select()
		.from(tenants)
		.where(where)
		.orderBy(asc(tenants.name))
		.limit(params.limit)
		.offset(offsetOf(params))
		.all()
	const totalRow = db.select({ n: count() }).from(tenants).where(where).get()
	return pageOf(items, totalRow?.n ?? 0, params)
}

export function getTenant(id: string): Result<TenantRow, Error> {
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
	const row: TenantRow = {
		id: newId(),
		name: input.name,
		slug: input.slug,
		description: input.description ?? null,
		comments: input.comments ?? null,
	}
	try {
		db.insert(tenants).values(row).run()
	} catch (err) {
		if (isUniqueViolation(err)) {
			return Result.err(new DuplicateError('Tenant slug is already in use'))
		}
		return Result.err(err instanceof Error ? err : new Error(String(err)))
	}
	return Result.ok(row)
}

export function updateTenant(id: string, input: TenantUpdate): Result<TenantRow, Error> {
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

export function deleteTenant(id: string): Result<TenantRow, Error> {
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
	tenant?: string
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

export function getSite(id: string): Result<SiteRow, Error> {
	const row = getDb().select().from(sites).where(eq(sites.id, id)).get()
	if (!row) {
		return Result.err(new NotFoundError('Site not found'))
	}
	return Result.ok(row)
}

function checkTenant(tenantId: string | null | undefined): Result<undefined, Error> {
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
	const row: SiteRow = {
		id: newId(),
		tenant_id: input.tenant_id ?? null,
		name: input.name,
		slug: input.slug,
		group: input.group ?? null,
		description: input.description ?? null,
	}
	try {
		db.insert(sites).values(row).run()
	} catch (err) {
		if (isUniqueViolation(err)) {
			return Result.err(new DuplicateError('Site slug is already in use'))
		}
		return Result.err(err instanceof Error ? err : new Error(String(err)))
	}
	return Result.ok(row)
}

export function updateSite(id: string, input: SiteUpdate): Result<SiteRow, Error> {
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

export function deleteSite(id: string): Result<SiteRow, Error> {
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
	site?: string
	tenant?: string
	parent?: string
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

export function getLocation(id: string): Result<LocationRow, Error> {
	const row = getDb().select().from(locations).where(eq(locations.id, id)).get()
	if (!row) {
		return Result.err(new NotFoundError('Location not found'))
	}
	return Result.ok(row)
}

function siblingSlugClash(
	siteId: string,
	parentId: string | null,
	slug: string,
	excludeId?: string,
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
function siteParentMap(siteId: string): Map<string, string | null> {
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
	const row: LocationRow = {
		id: newId(),
		site_id: input.site_id,
		parent_id: parentId,
		tenant_id: input.tenant_id ?? null,
		name: input.name,
		slug: input.slug,
		description: input.description ?? null,
	}
	try {
		db.insert(locations).values(row).run()
	} catch (err) {
		if (isUniqueViolation(err)) {
			return Result.err(new DuplicateError('Location slug is already used under this parent'))
		}
		return Result.err(err instanceof Error ? err : new Error(String(err)))
	}
	return Result.ok(row)
}

export function updateLocation(id: string, input: LocationUpdate): Result<LocationRow, Error> {
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

export function deleteLocation(id: string): Result<LocationRow, Error> {
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
