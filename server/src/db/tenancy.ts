import { Result } from 'better-result'
import { and, asc, count, desc, eq, inArray, isNull, type SQL, sql } from 'drizzle-orm'
import {
	type LocationCreate,
	type LocationUpdate,
	MAX_LOCATION_DEPTH,
	type SiteCreate,
	type SiteGroupCreate,
	type SiteGroupUpdate,
	type SiteUpdate,
	type TenantCreate,
	type TenantGroupCreate,
	type TenantGroupUpdate,
	type TenantUpdate,
} from 'shared/src/schemas'
import {
	devices,
	external_links,
	locations,
	racks,
	site_groups,
	sites,
	tenant_groups,
	tenants,
	users,
} from '../schema'
import {
	buildChildrenMap,
	buildParentMap,
	createsCycle,
	depthOf,
	maxDescendantOffset,
} from '../services/hierarchy'
import { logCreate, logDelete, logUpdate } from './changelog'
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
	type TenantFilterParams,
	tenantConditions,
} from './list'

export type { ListParams, Page } from './list'
export type TenantGroupRow = typeof tenant_groups.$inferSelect
export type TenantRow = typeof tenants.$inferSelect
export type SiteRow = typeof sites.$inferSelect
export type SiteGroupRow = typeof site_groups.$inferSelect
export type LocationRow = typeof locations.$inferSelect

export interface TenantListParams extends ListParams {
	/** Only tenants of this tenant group. */
	group?: number
	sort: 'name' | 'customer_number' | 'description'
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
// Tenant groups (flat, no nesting; they bundle tenants but own no inventory)
// ---------------------------------------------------------------------------

export interface TenantGroupListParams extends ListParams {
	sort: 'name' | 'slug' | 'description'
	order: 'asc' | 'desc'
	/**
	 * Tenant scope for scoped editors/viewers: restricts the list to the
	 * group containing this tenant. `undefined` means unconstrained.
	 */
	scopeTenantId?: number
}

/** One tenant group row for the list view, with its member count. */
export interface TenantGroupListItem extends TenantGroupRow {
	tenant_count: number
}

export async function listTenantGroups(
	params: TenantGroupListParams,
): Promise<Page<TenantGroupListItem>> {
	const db = getDb()
	const pattern = searchPattern(params.search)
	const conditions: SQL[] = []
	if (params.search) {
		conditions.push(
			sql`(${tenant_groups.name} ILIKE ${pattern} ESCAPE '\\' OR ${tenant_groups.slug} ILIKE ${pattern} ESCAPE '\\' OR ${tenant_groups.description} ILIKE ${pattern} ESCAPE '\\')`,
		)
	}
	if (params.scopeTenantId !== undefined) {
		conditions.push(
			sql`${tenant_groups.id} IN (SELECT ${tenants.tenant_group_id} FROM ${tenants} WHERE ${tenants.id} = ${params.scopeTenantId})`,
		)
	}
	const where = conditions.length > 0 ? and(...conditions) : undefined
	const orderColumn =
		params.sort === 'slug'
			? tenant_groups.slug
			: params.sort === 'description'
				? tenant_groups.description
				: tenant_groups.name
	const items = await db
		.select()
		.from(tenant_groups)
		.where(where)
		.orderBy(
			params.order === 'desc' ? desc(orderColumn) : asc(orderColumn),
			asc(tenant_groups.id),
		)
		.limit(params.limit)
		.offset(offsetOf(params))
	const totalRow = (await db.select({ n: count() }).from(tenant_groups).where(where).limit(1))[0]

	const counts = new Map<number, number>()
	if (items.length > 0) {
		for (const row of await db
			.select({ group: tenants.tenant_group_id, n: count() })
			.from(tenants)
			.where(
				inArray(
					tenants.tenant_group_id,
					items.map((g) => g.id),
				),
			)
			.groupBy(tenants.tenant_group_id)) {
			if (row.group !== null) {
				counts.set(row.group, row.n)
			}
		}
	}
	return pageOf(
		items.map((g) => ({ ...g, tenant_count: counts.get(g.id) ?? 0 })),
		totalRow?.n ?? 0,
		params,
	)
}

export async function getTenantGroup(id: number): Promise<Result<TenantGroupRow, Error>> {
	const row = (
		await getDb().select().from(tenant_groups).where(eq(tenant_groups.id, id)).limit(1)
	)[0]
	if (!row) {
		return Result.err(new NotFoundError('Tenant group not found'))
	}
	return Result.ok(row)
}

/** Ids of the tenants in a group; 404 when the group does not exist. */
export async function resolveTenantGroupIds(groupId: number): Promise<Result<number[], Error>> {
	const group = await getTenantGroup(groupId)
	if (Result.isError(group)) {
		return group
	}
	const rows = await getDb()
		.select({ id: tenants.id })
		.from(tenants)
		.where(eq(tenants.tenant_group_id, groupId))
	return Result.ok(rows.map((r) => r.id))
}

/** Customer number guard: null/undefined passes, missing id is 404. */
async function checkCustomerNumber(
	customerNumber: string | null | undefined,
	excludeTenantId?: number,
): Promise<Result<undefined, Error>> {
	if (customerNumber === null || customerNumber === undefined) {
		return Result.ok(undefined)
	}
	const clash = (
		await getDb()
			.select()
			.from(tenants)
			.where(eq(tenants.customer_number, customerNumber))
			.limit(1)
	)[0]
	if (clash && clash.id !== excludeTenantId) {
		return Result.err(new DuplicateError('Customer number is already in use'))
	}
	return Result.ok(undefined)
}

/** Maps a tenant unique violation to the colliding field (customer number). */
function duplicateTenantError(err: unknown): Error {
	const message = err instanceof Error ? err.message : String(err)
	if (message.includes('customer_number')) {
		return new DuplicateError('Customer number is already in use')
	}
	return err instanceof Error ? err : new Error(String(err))
}

/** Tenant group FK guard: null/undefined passes, missing id is 404. */
async function checkTenantGroupExists(
	groupId: number | null | undefined,
): Promise<Result<undefined, Error>> {
	if (groupId === null || groupId === undefined) {
		return Result.ok(undefined)
	}
	const group = await getTenantGroup(groupId)
	if (Result.isError(group)) {
		return group
	}
	return Result.ok(undefined)
}

export async function createTenantGroup(
	input: TenantGroupCreate,
): Promise<Result<TenantGroupRow, Error>> {
	const db = getDb()
	const row: Omit<TenantGroupRow, 'id'> = {
		name: input.name,
		slug: input.slug,
		description: input.description ?? null,
		comments: input.comments ?? null,
	}
	try {
		const inserted = (
			await db.insert(tenant_groups).values(row).returning({ id: tenant_groups.id })
		)[0]
		if (!inserted) {
			return Result.err(new Error('Tenant group insert did not return an id'))
		}
		return await logCreate('tenant_group', await getTenantGroup(inserted.id))
	} catch (err) {
		if (isUniqueViolation(err)) {
			return Result.err(new DuplicateError('Tenant group slug is already in use'))
		}
		return Result.err(errOf(err))
	}
}

export async function updateTenantGroup(
	id: number,
	input: TenantGroupUpdate,
): Promise<Result<TenantGroupRow, Error>> {
	const current = await getTenantGroup(id)
	if (Result.isError(current)) {
		return current
	}
	const patch: Partial<TenantGroupRow> = {}
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
			await getDb().update(tenant_groups).set(patch).where(eq(tenant_groups.id, id))
		} catch (err) {
			if (isUniqueViolation(err)) {
				return Result.err(new DuplicateError('Tenant group slug is already in use'))
			}
			return Result.err(errOf(err))
		}
	}
	return await logUpdate('tenant_group', current.value, await getTenantGroup(id))
}

export async function deleteTenantGroup(id: number): Promise<Result<TenantGroupRow, Error>> {
	const current = await getTenantGroup(id)
	if (Result.isError(current)) {
		return current
	}
	const db = getDb()
	const member = (
		await db.select().from(tenants).where(eq(tenants.tenant_group_id, id)).limit(1)
	)[0]
	if (member) {
		return Result.err(
			new ConflictError('Tenant group still has tenants; move or delete them first'),
		)
	}
	try {
		await db.delete(tenant_groups).where(eq(tenant_groups.id, id))
	} catch (e) {
		return Result.err(errOf(e))
	}
	return await logDelete('tenant_group', current.value)
}

// ---------------------------------------------------------------------------
// Tenants
// ---------------------------------------------------------------------------

export async function listTenants(params: TenantListParams): Promise<Page<TenantListItem>> {
	const db = getDb()
	const pattern = searchPattern(params.search)
	const conditions: SQL[] = []
	if (params.search) {
		conditions.push(
			sql`(${tenants.name} ILIKE ${pattern} ESCAPE '\\' OR ${tenants.customer_number} ILIKE ${pattern} ESCAPE '\\' OR ${tenants.description} ILIKE ${pattern} ESCAPE '\\')`,
		)
	}
	if (params.group !== undefined) {
		conditions.push(eq(tenants.tenant_group_id, params.group))
	}
	if (params.scopeTenantId !== undefined) {
		conditions.push(eq(tenants.id, params.scopeTenantId))
	}
	const where = conditions.length > 0 ? and(...conditions) : undefined
	const orderColumn =
		params.sort === 'customer_number'
			? tenants.customer_number
			: params.sort === 'description'
				? tenants.description
				: tenants.name
	const items = await db
		.select()
		.from(tenants)
		.where(where)
		.orderBy(params.order === 'desc' ? desc(orderColumn) : asc(orderColumn), asc(tenants.id))
		.limit(params.limit)
		.offset(offsetOf(params))
	const totalRow = (await db.select({ n: count() }).from(tenants).where(where).limit(1))[0]
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
		for (const row of await db
			.select({ tenant_id: sites.tenant_id, n: count() })
			.from(sites)
			.where(inArray(sites.tenant_id, ids))
			.groupBy(sites.tenant_id)) {
			apply(row.tenant_id, 'sites', row.n)
		}
		for (const row of await db
			.select({ tenant_id: racks.tenant_id, n: count() })
			.from(racks)
			.where(inArray(racks.tenant_id, ids))
			.groupBy(racks.tenant_id)) {
			apply(row.tenant_id, 'racks', row.n)
		}
		for (const row of await db
			.select({ tenant_id: devices.tenant_id, n: count() })
			.from(devices)
			.where(inArray(devices.tenant_id, ids))
			.groupBy(devices.tenant_id)) {
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

export async function getTenant(id: number): Promise<Result<TenantRow, Error>> {
	const row = (await getDb().select().from(tenants).where(eq(tenants.id, id)).limit(1))[0]
	if (!row) {
		return Result.err(new NotFoundError('Tenant not found'))
	}
	return Result.ok(row)
}

export async function createTenant(input: TenantCreate): Promise<Result<TenantRow, Error>> {
	const db = getDb()
	const groupExists = await checkTenantGroupExists(input.tenant_group_id)
	if (Result.isError(groupExists)) {
		return groupExists
	}
	const numberCheck = await checkCustomerNumber(input.customer_number)
	if (Result.isError(numberCheck)) {
		return numberCheck
	}
	const row: Omit<TenantRow, 'id'> = {
		tenant_group_id: input.tenant_group_id ?? null,
		name: input.name,
		customer_number: input.customer_number ?? null,
		description: input.description ?? null,
		comments: input.comments ?? null,
	}
	try {
		const inserted = (await db.insert(tenants).values(row).returning({ id: tenants.id }))[0]
		if (!inserted) {
			return Result.err(new Error('Tenant insert did not return an id'))
		}
		return await logCreate('tenant', await getTenant(inserted.id))
	} catch (err) {
		if (isUniqueViolation(err)) {
			return Result.err(duplicateTenantError(err))
		}
		return Result.err(err instanceof Error ? err : new Error(String(err)))
	}
}

export async function updateTenant(
	id: number,
	input: TenantUpdate,
): Promise<Result<TenantRow, Error>> {
	const current = await getTenant(id)
	if (Result.isError(current)) {
		return current
	}
	const db = getDb()
	const groupExists = await checkTenantGroupExists(input.tenant_group_id)
	if (Result.isError(groupExists)) {
		return groupExists
	}
	const numberCheck = await checkCustomerNumber(input.customer_number, id)
	if (Result.isError(numberCheck)) {
		return numberCheck
	}
	const patch: Partial<TenantRow> = {}
	if (input.tenant_group_id !== undefined) {
		patch.tenant_group_id = input.tenant_group_id
	}
	if (input.name !== undefined) {
		patch.name = input.name
	}
	if (input.customer_number !== undefined) {
		patch.customer_number = input.customer_number
	}
	if (input.description !== undefined) {
		patch.description = input.description
	}
	if (input.comments !== undefined) {
		patch.comments = input.comments
	}
	if (!isPatchEmpty(patch)) {
		try {
			await db.update(tenants).set(patch).where(eq(tenants.id, id))
		} catch (err) {
			if (isUniqueViolation(err)) {
				return Result.err(duplicateTenantError(err))
			}
			return Result.err(err instanceof Error ? err : new Error(String(err)))
		}
	}
	return await logUpdate('tenant', current.value, await getTenant(id))
}

export async function deleteTenant(id: number): Promise<Result<TenantRow, Error>> {
	const current = await getTenant(id)
	if (Result.isError(current)) {
		return current
	}
	const db = getDb()
	const siteChild = (await db.select().from(sites).where(eq(sites.tenant_id, id)).limit(1))[0]
	if (siteChild) {
		return Result.err(new ConflictError('Tenant still has sites; move or delete them first'))
	}
	const groupChild = (
		await db.select().from(site_groups).where(eq(site_groups.tenant_id, id)).limit(1)
	)[0]
	if (groupChild) {
		return Result.err(
			new ConflictError('Tenant still has site groups; move or delete them first'),
		)
	}
	const rackChild = (await db.select().from(racks).where(eq(racks.tenant_id, id)).limit(1))[0]
	if (rackChild) {
		return Result.err(new ConflictError('Tenant still has racks; move or delete them first'))
	}
	const deviceChild = (
		await db.select().from(devices).where(eq(devices.tenant_id, id)).limit(1)
	)[0]
	if (deviceChild) {
		return Result.err(new ConflictError('Tenant still has devices; move or delete them first'))
	}
	const userChild = (await db.select().from(users).where(eq(users.tenant_id, id)).limit(1))[0]
	if (userChild) {
		return Result.err(
			new ConflictError('Tenant still has users; reassign them before deleting'),
		)
	}
	try {
		await db.transaction(async (tx) => {
			await tx
				.delete(external_links)
				.where(
					and(eq(external_links.entity_type, 'tenant'), eq(external_links.entity_id, id)),
				)
			await tx.delete(tenants).where(eq(tenants.id, id))
		})
	} catch (e) {
		return Result.err(errOf(e))
	}
	return await logDelete('tenant', current.value)
}

// ---------------------------------------------------------------------------
// Sites
// ---------------------------------------------------------------------------

export interface SiteListParams extends ListParams, TenantFilterParams {
	group?: number
	sort: 'name' | 'description'
	order: 'asc' | 'desc'
}

export async function listSites(params: SiteListParams): Promise<Page<SiteRow>> {
	const db = getDb()
	const pattern = searchPattern(params.search)
	const conditions: SQL[] = []
	if (params.search) {
		conditions.push(
			sql`(${sites.name} ILIKE ${pattern} ESCAPE '\\' OR ${sites.description} ILIKE ${pattern} ESCAPE '\\')`,
		)
	}
	if (params.group) {
		conditions.push(eq(sites.site_group_id, params.group))
	}
	conditions.push(...tenantConditions(sites.tenant_id, params))
	const where = conditions.length > 0 ? and(...conditions) : undefined
	const orderColumn = params.sort === 'description' ? sites.description : sites.name
	const items = await db
		.select()
		.from(sites)
		.where(where)
		.orderBy(params.order === 'desc' ? desc(orderColumn) : asc(orderColumn), asc(sites.id))
		.limit(params.limit)
		.offset(offsetOf(params))
	const totalRow = (await db.select({ n: count() }).from(sites).where(where).limit(1))[0]
	return pageOf(items, totalRow?.n ?? 0, params)
}

export async function getSite(id: number): Promise<Result<SiteRow, Error>> {
	const row = (await getDb().select().from(sites).where(eq(sites.id, id)).limit(1))[0]
	if (!row) {
		return Result.err(new NotFoundError('Site not found'))
	}
	return Result.ok(row)
}

async function checkSiteGroup(
	groupId: number | null | undefined,
): Promise<Result<undefined, Error>> {
	if (groupId === null || groupId === undefined) {
		return Result.ok(undefined)
	}
	const group = (
		await getDb().select().from(site_groups).where(eq(site_groups.id, groupId)).limit(1)
	)[0]
	if (!group) {
		return Result.err(new NotFoundError('Site group not found'))
	}
	return Result.ok(undefined)
}

export async function createSite(input: SiteCreate): Promise<Result<SiteRow, Error>> {
	const tenantCheck = await checkTenantExists(input.tenant_id)
	if (Result.isError(tenantCheck)) {
		return Result.err(tenantCheck.error)
	}
	const groupCheck = await checkSiteGroup(input.site_group_id)
	if (Result.isError(groupCheck)) {
		return Result.err(groupCheck.error)
	}
	const db = getDb()
	const row: Omit<SiteRow, 'id'> = {
		tenant_id: input.tenant_id ?? null,
		site_group_id: input.site_group_id ?? null,
		name: input.name,
		description: input.description ?? null,
		comments: input.comments ?? null,
		physical_address: input.physical_address ?? null,
		shipping_address: input.shipping_address ?? null,
	}
	try {
		const inserted = (await db.insert(sites).values(row).returning({ id: sites.id }))[0]
		if (!inserted) {
			return Result.err(new Error('Site insert did not return an id'))
		}
		return await logCreate('site', await getSite(inserted.id))
	} catch (err) {
		return Result.err(err instanceof Error ? err : new Error(String(err)))
	}
}

export async function updateSite(id: number, input: SiteUpdate): Promise<Result<SiteRow, Error>> {
	const current = await getSite(id)
	if (Result.isError(current)) {
		return current
	}
	if (input.tenant_id !== undefined) {
		const tenantCheck = await checkTenantExists(input.tenant_id)
		if (Result.isError(tenantCheck)) {
			return Result.err(tenantCheck.error)
		}
	}
	if (input.site_group_id !== undefined) {
		const groupCheck = await checkSiteGroup(input.site_group_id)
		if (Result.isError(groupCheck)) {
			return Result.err(groupCheck.error)
		}
	}
	const db = getDb()
	const patch: Partial<SiteRow> = {}
	if (input.name !== undefined) {
		patch.name = input.name
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
			await db.update(sites).set(patch).where(eq(sites.id, id))
		} catch (err) {
			return Result.err(err instanceof Error ? err : new Error(String(err)))
		}
	}
	return await logUpdate('site', current.value, await getSite(id))
}

export async function deleteSite(id: number): Promise<Result<SiteRow, Error>> {
	const current = await getSite(id)
	if (Result.isError(current)) {
		return current
	}
	const child = (
		await getDb().select().from(locations).where(eq(locations.site_id, id)).limit(1)
	)[0]
	if (child) {
		return Result.err(new ConflictError('Site still has locations; move or delete them first'))
	}
	const rackChild = (await getDb().select().from(racks).where(eq(racks.site_id, id)).limit(1))[0]
	if (rackChild) {
		return Result.err(new ConflictError('Site still has racks; move or delete them first'))
	}
	try {
		await getDb().delete(sites).where(eq(sites.id, id))
	} catch (e) {
		return Result.err(errOf(e))
	}
	return await logDelete('site', current.value)
}

// ---------------------------------------------------------------------------
// Site groups (flat, no nesting; they bundle sites but own no inventory)
// ---------------------------------------------------------------------------

export interface SiteGroupListParams extends ListParams, TenantFilterParams {
	sort: 'name' | 'slug' | 'description'
	order: 'asc' | 'desc'
}

export async function listSiteGroups(params: SiteGroupListParams): Promise<Page<SiteGroupRow>> {
	const db = getDb()
	const pattern = searchPattern(params.search)
	const conditions: SQL[] = []
	if (params.search) {
		conditions.push(
			sql`(${site_groups.name} ILIKE ${pattern} ESCAPE '\\' OR ${site_groups.slug} ILIKE ${pattern} ESCAPE '\\')`,
		)
	}
	conditions.push(...tenantConditions(site_groups.tenant_id, params))
	const where = conditions.length > 0 ? and(...conditions) : undefined
	const orderColumn =
		params.sort === 'slug'
			? site_groups.slug
			: params.sort === 'description'
				? site_groups.description
				: site_groups.name
	const items = await db
		.select()
		.from(site_groups)
		.where(where)
		.orderBy(
			params.order === 'desc' ? desc(orderColumn) : asc(orderColumn),
			asc(site_groups.id),
		)
		.limit(params.limit)
		.offset(offsetOf(params))
	const totalRow = (await db.select({ n: count() }).from(site_groups).where(where).limit(1))[0]
	return pageOf(items, totalRow?.n ?? 0, params)
}

export async function getSiteGroup(id: number): Promise<Result<SiteGroupRow, Error>> {
	const row = (await getDb().select().from(site_groups).where(eq(site_groups.id, id)).limit(1))[0]
	if (!row) {
		return Result.err(new NotFoundError('Site group not found'))
	}
	return Result.ok(row)
}

async function slugUnderParentClash(
	table: typeof locations,
	parentCol: typeof locations.parent_id,
	slugCol: typeof locations.slug,
	parentId: number | null,
	slug: string,
	excludeId?: number,
	extra?: SQL,
): Promise<boolean> {
	const parentCond = parentId === null ? isNull(parentCol) : eq(parentCol, parentId)
	const conds = extra ? [parentCond, eq(slugCol, slug), extra] : [parentCond, eq(slugCol, slug)]
	const clash = (
		await getDb()
			.select()
			// biome-ignore lint/suspicious/noExplicitAny: generic over two tables with identical columns
			.from(table as any)
			.where(and(...conds))
			.limit(1)
	)[0] as { id: number } | undefined
	return !!clash && clash.id !== excludeId
}

export async function createSiteGroup(
	input: SiteGroupCreate,
): Promise<Result<SiteGroupRow, Error>> {
	const tenantCheck = await checkTenantExists(input.tenant_id)
	if (Result.isError(tenantCheck)) {
		return Result.err(tenantCheck.error)
	}
	const row: Omit<SiteGroupRow, 'id'> = {
		tenant_id: input.tenant_id ?? null,
		name: input.name,
		slug: input.slug,
		description: input.description ?? null,
		comments: input.comments ?? null,
	}
	try {
		const inserted = (
			await getDb().insert(site_groups).values(row).returning({ id: site_groups.id })
		)[0]
		if (!inserted) {
			return Result.err(new Error('Site group insert did not return an id'))
		}
		return await logCreate('site_group', await getSiteGroup(inserted.id))
	} catch (err) {
		if (isUniqueViolation(err)) {
			return Result.err(new DuplicateError('Site group slug is already in use'))
		}
		return Result.err(err instanceof Error ? err : new Error(String(err)))
	}
}

export async function updateSiteGroup(
	id: number,
	input: SiteGroupUpdate,
): Promise<Result<SiteGroupRow, Error>> {
	const current = await getSiteGroup(id)
	if (Result.isError(current)) {
		return current
	}
	if (input.tenant_id !== undefined) {
		const tenantCheck = await checkTenantExists(input.tenant_id)
		if (Result.isError(tenantCheck)) {
			return Result.err(tenantCheck.error)
		}
	}
	const patch: Partial<SiteGroupRow> = {}
	if (input.name !== undefined) {
		patch.name = input.name
	}
	if (input.slug !== undefined) {
		patch.slug = input.slug
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
			await getDb().update(site_groups).set(patch).where(eq(site_groups.id, id))
		} catch (err) {
			if (isUniqueViolation(err)) {
				return Result.err(new DuplicateError('Site group slug is already in use'))
			}
			return Result.err(err instanceof Error ? err : new Error(String(err)))
		}
	}
	return await logUpdate('site_group', current.value, await getSiteGroup(id))
}

export async function deleteSiteGroup(id: number): Promise<Result<SiteGroupRow, Error>> {
	const current = await getSiteGroup(id)
	if (Result.isError(current)) {
		return current
	}
	const db = getDb()
	const siteChild = (await db.select().from(sites).where(eq(sites.site_group_id, id)).limit(1))[0]
	if (siteChild) {
		return Result.err(
			new ConflictError('Site group still has sites; move or delete them first'),
		)
	}
	try {
		await db.delete(site_groups).where(eq(site_groups.id, id))
	} catch (e) {
		return Result.err(errOf(e))
	}
	return await logDelete('site_group', current.value)
}

// ---------------------------------------------------------------------------
// Locations
// ---------------------------------------------------------------------------

export interface LocationListParams extends ListParams, TenantFilterParams {
	site?: number
	parent?: number
	sort: 'name' | 'slug' | 'description'
	order: 'asc' | 'desc'
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

export async function listLocations(params: LocationListParams): Promise<Page<LocationRow>> {
	const db = getDb()
	const pattern = searchPattern(params.search)
	const conditions: SQL[] = []
	if (params.search) {
		conditions.push(
			sql`(${locations.name} ILIKE ${pattern} ESCAPE '\\' OR ${locations.slug} ILIKE ${pattern} ESCAPE '\\')`,
		)
	}
	if (params.site) {
		conditions.push(eq(locations.site_id, params.site))
	}
	if (params.parent) {
		conditions.push(eq(locations.parent_id, params.parent))
	}
	conditions.push(...tenantConditions(locations.tenant_id, params))
	const where = conditions.length > 0 ? and(...conditions) : undefined
	const matching = await db.select().from(locations).where(where)
	const ordered = sortLocationsHierarchically(matching, params.sort, params.order)
	const items = ordered.slice(offsetOf(params), offsetOf(params) + params.limit)
	const totalRow = (await db.select({ n: count() }).from(locations).where(where).limit(1))[0]
	return pageOf(items, totalRow?.n ?? 0, params)
}

export async function getLocation(id: number): Promise<Result<LocationRow, Error>> {
	const row = (await getDb().select().from(locations).where(eq(locations.id, id)).limit(1))[0]
	if (!row) {
		return Result.err(new NotFoundError('Location not found'))
	}
	return Result.ok(row)
}

async function siblingSlugClash(
	siteId: number,
	parentId: number | null,
	slug: string,
	excludeId?: number,
): Promise<boolean> {
	return await slugUnderParentClash(
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
async function siteParentMap(siteId: number): Promise<Map<number, number | null>> {
	const rows = await getDb()
		.select({ id: locations.id, parent_id: locations.parent_id })
		.from(locations)
		.where(eq(locations.site_id, siteId))
	return buildParentMap(rows)
}

export async function createLocation(input: LocationCreate): Promise<Result<LocationRow, Error>> {
	const db = getDb()
	const site = (await db.select().from(sites).where(eq(sites.id, input.site_id)).limit(1))[0]
	if (!site) {
		return Result.err(new NotFoundError('Site not found'))
	}
	const tenantCheck = await checkTenantExists(input.tenant_id)
	if (Result.isError(tenantCheck)) {
		return Result.err(tenantCheck.error)
	}
	const parentId = input.parent_id ?? null
	const parents = await siteParentMap(input.site_id)
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
	if (await siblingSlugClash(input.site_id, parentId, input.slug)) {
		return Result.err(new DuplicateError('Location slug is already used under this parent'))
	}
	const row: Omit<LocationRow, 'id'> = {
		site_id: input.site_id,
		parent_id: parentId,
		tenant_id: input.tenant_id ?? null,
		name: input.name,
		slug: input.slug,
		type: input.type,
		description: input.description ?? null,
	}
	try {
		const inserted = (await db.insert(locations).values(row).returning({ id: locations.id }))[0]
		if (!inserted) {
			return Result.err(new Error('Location insert did not return an id'))
		}
		return await logCreate('location', await getLocation(inserted.id))
	} catch (err) {
		if (isUniqueViolation(err)) {
			return Result.err(new DuplicateError('Location slug is already used under this parent'))
		}
		return Result.err(err instanceof Error ? err : new Error(String(err)))
	}
}

export async function updateLocation(
	id: number,
	input: LocationUpdate,
): Promise<Result<LocationRow, Error>> {
	const current = await getLocation(id)
	if (Result.isError(current)) {
		return current
	}
	const node = current.value
	if (input.tenant_id !== undefined) {
		const tenantCheck = await checkTenantExists(input.tenant_id)
		if (Result.isError(tenantCheck)) {
			return Result.err(tenantCheck.error)
		}
	}
	const effectiveParent = input.parent_id !== undefined ? input.parent_id : node.parent_id
	const effectiveSlug = input.slug !== undefined ? input.slug : node.slug

	if (effectiveParent !== undefined && effectiveParent !== null) {
		const parents = await siteParentMap(node.site_id)
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
		const rows = await getDb()
			.select({ id: locations.id, parent_id: locations.parent_id })
			.from(locations)
			.where(eq(locations.site_id, node.site_id))
		const subtreeGrowth = maxDescendantOffset(id, buildChildrenMap(rows))
		if (parentDepth.value + 1 + subtreeGrowth > MAX_LOCATION_DEPTH) {
			return Result.err(
				new ConflictError(`Location hierarchy is limited to ${MAX_LOCATION_DEPTH} levels`),
			)
		}
	}
	if (await siblingSlugClash(node.site_id, effectiveParent ?? null, effectiveSlug, id)) {
		return Result.err(new DuplicateError('Location slug is already used under this parent'))
	}
	const patch: Partial<LocationRow> = {}
	if (input.name !== undefined) {
		patch.name = input.name
	}
	if (input.slug !== undefined) {
		patch.slug = input.slug
	}
	if (input.type !== undefined) {
		patch.type = input.type
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
			await getDb().update(locations).set(patch).where(eq(locations.id, id))
		} catch (err) {
			if (isUniqueViolation(err)) {
				return Result.err(
					new DuplicateError('Location slug is already used under this parent'),
				)
			}
			return Result.err(err instanceof Error ? err : new Error(String(err)))
		}
	}
	return await logUpdate('location', current.value, await getLocation(id))
}

export async function deleteLocation(id: number): Promise<Result<LocationRow, Error>> {
	const current = await getLocation(id)
	if (Result.isError(current)) {
		return current
	}
	const child = (
		await getDb().select().from(locations).where(eq(locations.parent_id, id)).limit(1)
	)[0]
	if (child) {
		return Result.err(
			new ConflictError('Location still has child locations; move or delete them first'),
		)
	}
	const rackChild = (
		await getDb().select().from(racks).where(eq(racks.location_id, id)).limit(1)
	)[0]
	if (rackChild) {
		return Result.err(new ConflictError('Location still has racks; move or delete them first'))
	}
	try {
		await getDb().delete(locations).where(eq(locations.id, id))
	} catch (e) {
		return Result.err(errOf(e))
	}
	return await logDelete('location', current.value)
}
