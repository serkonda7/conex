import { Result } from 'better-result'
import { and, asc, count, eq, inArray, type SQL, sql } from 'drizzle-orm'
import type { PgTable } from 'drizzle-orm/pg-core'
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
	employees,
	external_links,
	locations,
	racks,
	site_groups,
	sites,
	tenant_groups,
	tenants,
	users,
	virtual_machines,
} from '../schema'
import {
	buildChildrenMap,
	buildParentMap,
	createsCycle,
	depthOf,
	maxDescendantOffset,
	sortHierarchically,
} from '../services/hierarchy'
import { removeAttachmentFiles } from '../storage'
import {
	type AttachmentRow,
	checkFloorplanDelete,
	deleteOwnerAttachments,
	prunePlacements,
} from './attachments'
import { logCreate, logDelete, logUpdate } from './changelog'
import { getDb, withTransaction } from './connection'
import { ConflictError, DuplicateError, NotFoundError } from './errors'
import {
	checkExists,
	checkTenantExists,
	errOf,
	exists,
	findById,
	insertedId,
	isPatchEmpty,
	isTaken,
	type ListParams,
	offsetOf,
	orderOf,
	type Page,
	pageOf,
	pageRows,
	pickDefined,
	searchCondition,
	type TenantFilterParams,
	tenantConditions,
	tryWrite,
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

/**
 * Delete guard: the first dependent table that still references the row
 * answers 409 with its message.
 */
async function checkNoDependents(
	dependents: [table: PgTable, where: SQL, message: string][],
): Promise<Result<undefined, Error>> {
	for (const [table, where, message] of dependents) {
		if (await exists(table, where)) {
			return Result.err(new ConflictError(message))
		}
	}
	return Result.ok(undefined)
}

// ---------------------------------------------------------------------------
// Tenant groups (flat, no nesting; they bundle tenants but own no inventory)
// ---------------------------------------------------------------------------

export interface TenantGroupListParams extends ListParams {
	sort: 'name' | 'description'
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
	const where = and(
		searchCondition(params.search, [tenant_groups.name, tenant_groups.description]),
		params.scopeTenantId !== undefined
			? sql`${tenant_groups.id} IN (SELECT ${tenants.tenant_group_id} FROM ${tenants} WHERE ${tenants.id} = ${params.scopeTenantId})`
			: undefined,
	)
	const orderColumn =
		params.sort === 'description' ? tenant_groups.description : tenant_groups.name
	const page = await pageRows(
		tenant_groups,
		where,
		[orderOf(orderColumn, params.order), asc(tenant_groups.id)],
		params,
	)
	const counts = new Map<number, number>()
	if (page.items.length > 0) {
		for (const row of await getDb()
			.select({ group: tenants.tenant_group_id, n: count() })
			.from(tenants)
			.where(
				inArray(
					tenants.tenant_group_id,
					page.items.map((g) => g.id),
				),
			)
			.groupBy(tenants.tenant_group_id)) {
			if (row.group !== null) {
				counts.set(row.group, row.n)
			}
		}
	}
	return {
		...page,
		items: page.items.map((g) => ({ ...g, tenant_count: counts.get(g.id) ?? 0 })),
	}
}

export function getTenantGroup(id: number): Promise<Result<TenantGroupRow, Error>> {
	return findById(tenant_groups, id, 'Tenant group not found')
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

export async function createTenantGroup(
	input: TenantGroupCreate,
): Promise<Result<TenantGroupRow, Error>> {
	const row: Omit<TenantGroupRow, 'id'> = {
		name: input.name,
		description: input.description ?? null,
		comments: input.comments ?? null,
	}
	const id = await tryWrite(async () =>
		insertedId(
			await getDb().insert(tenant_groups).values(row).returning({ id: tenant_groups.id }),
		),
	)
	if (Result.isError(id)) {
		return id
	}
	return await logCreate('tenant_group', await getTenantGroup(id.value))
}

export async function updateTenantGroup(
	id: number,
	input: TenantGroupUpdate,
): Promise<Result<TenantGroupRow, Error>> {
	const current = await getTenantGroup(id)
	if (Result.isError(current)) {
		return current
	}
	const patch = pickDefined(input, ['name', 'description', 'comments'])
	if (!isPatchEmpty(patch)) {
		const written = await tryWrite(() =>
			getDb().update(tenant_groups).set(patch).where(eq(tenant_groups.id, id)),
		)
		if (Result.isError(written)) {
			return written
		}
	}
	return await logUpdate('tenant_group', current.value, await getTenantGroup(id))
}

export async function deleteTenantGroup(id: number): Promise<Result<TenantGroupRow, Error>> {
	const current = await getTenantGroup(id)
	if (Result.isError(current)) {
		return current
	}
	const blocked = await checkNoDependents([
		[
			tenants,
			eq(tenants.tenant_group_id, id),
			'Tenant group still has tenants; move or delete them first',
		],
	])
	if (Result.isError(blocked)) {
		return blocked
	}
	const deleted = await tryWrite(() =>
		getDb().delete(tenant_groups).where(eq(tenant_groups.id, id)),
	)
	if (Result.isError(deleted)) {
		return deleted
	}
	return await logDelete('tenant_group', current.value)
}

// ---------------------------------------------------------------------------
// Tenants
// ---------------------------------------------------------------------------

const CUSTOMER_NUMBER_IN_USE = 'Customer number is already in use'

export async function listTenants(params: TenantListParams): Promise<Page<TenantListItem>> {
	const where = and(
		searchCondition(params.search, [
			tenants.name,
			tenants.customer_number,
			tenants.description,
			tenants.website,
			sql`jsonb_path_query_array(${tenants.emails}, '$[*].address')::text`,
			sql`jsonb_path_query_array(${tenants.phones}, '$[*].number')::text`,
		]),
		params.group !== undefined ? eq(tenants.tenant_group_id, params.group) : undefined,
		params.scopeTenantId !== undefined ? eq(tenants.id, params.scopeTenantId) : undefined,
	)
	const orderColumn =
		params.sort === 'customer_number'
			? tenants.customer_number
			: params.sort === 'description'
				? tenants.description
				: tenants.name
	const page = await pageRows(
		tenants,
		where,
		[orderOf(orderColumn, params.order), asc(tenants.id)],
		params,
	)

	// NetBox-style related-object counts for the list view. One grouped
	// query per table keeps this O(1) queries instead of O(page size).
	const ids = page.items.map((t) => t.id)
	const countsOf = async (
		table: typeof sites | typeof racks | typeof devices,
	): Promise<Map<number, number>> => {
		const counts = new Map<number, number>()
		if (ids.length > 0) {
			for (const row of await getDb()
				.select({ tenant_id: table.tenant_id, n: count() })
				.from(table)
				.where(inArray(table.tenant_id, ids))
				.groupBy(table.tenant_id)) {
				if (row.tenant_id !== null) {
					counts.set(row.tenant_id, row.n)
				}
			}
		}
		return counts
	}
	const siteCounts = await countsOf(sites)
	const rackCounts = await countsOf(racks)
	const deviceCounts = await countsOf(devices)
	return {
		...page,
		items: page.items.map((t) => ({
			...t,
			site_count: siteCounts.get(t.id) ?? 0,
			rack_count: rackCounts.get(t.id) ?? 0,
			device_count: deviceCounts.get(t.id) ?? 0,
		})),
	}
}

export function getTenant(id: number): Promise<Result<TenantRow, Error>> {
	return findById(tenants, id, 'Tenant not found')
}

/** FK and customer-number guards shared by tenant create/update. */
async function checkTenantInput(
	input: { tenant_group_id?: number | null; customer_number?: string | null },
	excludeTenantId?: number,
): Promise<Result<undefined, Error>> {
	const group = await checkExists(tenant_groups, input.tenant_group_id, 'Tenant group not found')
	if (Result.isError(group)) {
		return group
	}
	if (
		typeof input.customer_number === 'string' &&
		(await isTaken(
			tenants,
			eq(tenants.customer_number, input.customer_number),
			excludeTenantId,
		))
	) {
		return Result.err(new DuplicateError(CUSTOMER_NUMBER_IN_USE))
	}
	return Result.ok(undefined)
}

/** Maps a tenant unique violation to the colliding field (customer number). */
function duplicateTenantError(err: unknown): Error {
	if (errOf(err).message.includes('customer_number')) {
		return new DuplicateError(CUSTOMER_NUMBER_IN_USE)
	}
	return errOf(err)
}

export async function createTenant(input: TenantCreate): Promise<Result<TenantRow, Error>> {
	const valid = await checkTenantInput(input)
	if (Result.isError(valid)) {
		return valid
	}
	const row: Omit<TenantRow, 'id'> = {
		tenant_group_id: input.tenant_group_id ?? null,
		name: input.name,
		customer_number: input.customer_number ?? null,
		website: input.website ?? null,
		emails: input.emails,
		phones: input.phones,
		description: input.description ?? null,
		comments: input.comments ?? null,
	}
	const id = await tryWrite(
		async () =>
			insertedId(await getDb().insert(tenants).values(row).returning({ id: tenants.id })),
		duplicateTenantError,
	)
	if (Result.isError(id)) {
		return id
	}
	return await logCreate('tenant', await getTenant(id.value))
}

export async function updateTenant(
	id: number,
	input: TenantUpdate,
): Promise<Result<TenantRow, Error>> {
	const current = await getTenant(id)
	if (Result.isError(current)) {
		return current
	}
	const valid = await checkTenantInput(input, id)
	if (Result.isError(valid)) {
		return valid
	}
	const patch = pickDefined(input, [
		'tenant_group_id',
		'name',
		'customer_number',
		'website',
		'emails',
		'phones',
		'description',
		'comments',
	])
	if (!isPatchEmpty(patch)) {
		const written = await tryWrite(
			() => getDb().update(tenants).set(patch).where(eq(tenants.id, id)),
			duplicateTenantError,
		)
		if (Result.isError(written)) {
			return written
		}
	}
	return await logUpdate('tenant', current.value, await getTenant(id))
}

export async function deleteTenant(id: number): Promise<Result<TenantRow, Error>> {
	const current = await getTenant(id)
	if (Result.isError(current)) {
		return current
	}
	const blocked = await checkNoDependents([
		[sites, eq(sites.tenant_id, id), 'Tenant still has sites; move or delete them first'],
		[
			site_groups,
			eq(site_groups.tenant_id, id),
			'Tenant still has site groups; move or delete them first',
		],
		[racks, eq(racks.tenant_id, id), 'Tenant still has racks; move or delete them first'],
		[devices, eq(devices.tenant_id, id), 'Tenant still has devices; move or delete them first'],
		[
			virtual_machines,
			eq(virtual_machines.tenant_id, id),
			'Tenant still has virtual machines; move or delete them first',
		],
		[
			employees,
			eq(employees.tenant_id, id),
			'Tenant still has employees; move or delete them first',
		],
		[users, eq(users.tenant_id, id), 'Tenant still has users; reassign them before deleting'],
	])
	if (Result.isError(blocked)) {
		return blocked
	}
	const deleted = await tryWrite(() =>
		getDb().transaction(async (tx) => {
			await tx
				.delete(external_links)
				.where(
					and(eq(external_links.entity_type, 'tenant'), eq(external_links.entity_id, id)),
				)
			await tx.delete(tenants).where(eq(tenants.id, id))
		}),
	)
	if (Result.isError(deleted)) {
		return deleted
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

export function listSites(params: SiteListParams): Promise<Page<SiteRow>> {
	const where = and(
		searchCondition(params.search, [sites.name, sites.description]),
		params.group ? eq(sites.site_group_id, params.group) : undefined,
		...tenantConditions(sites.tenant_id, params),
	)
	const orderColumn = params.sort === 'description' ? sites.description : sites.name
	return pageRows(sites, where, [orderOf(orderColumn, params.order), asc(sites.id)], params)
}

export function getSite(id: number): Promise<Result<SiteRow, Error>> {
	return findById(sites, id, 'Site not found')
}

/** FK guards shared by site create/update. */
async function checkSiteInput(input: {
	tenant_id?: number | null
	site_group_id?: number | null
}): Promise<Result<undefined, Error>> {
	const tenant = await checkTenantExists(input.tenant_id)
	if (Result.isError(tenant)) {
		return tenant
	}
	return checkExists(site_groups, input.site_group_id, 'Site group not found')
}

export async function createSite(input: SiteCreate): Promise<Result<SiteRow, Error>> {
	const valid = await checkSiteInput(input)
	if (Result.isError(valid)) {
		return valid
	}
	const row: Omit<SiteRow, 'id'> = {
		tenant_id: input.tenant_id ?? null,
		site_group_id: input.site_group_id ?? null,
		name: input.name,
		description: input.description ?? null,
		comments: input.comments ?? null,
		physical_street: input.physical_street ?? null,
		physical_postcode: input.physical_postcode ?? null,
		physical_city: input.physical_city ?? null,
		shipping_street: input.shipping_street ?? null,
		shipping_postcode: input.shipping_postcode ?? null,
		shipping_city: input.shipping_city ?? null,
	}
	const id = await tryWrite(async () =>
		insertedId(await getDb().insert(sites).values(row).returning({ id: sites.id })),
	)
	if (Result.isError(id)) {
		return id
	}
	return await logCreate('site', await getSite(id.value))
}

export async function updateSite(id: number, input: SiteUpdate): Promise<Result<SiteRow, Error>> {
	const current = await getSite(id)
	if (Result.isError(current)) {
		return current
	}
	const valid = await checkSiteInput(input)
	if (Result.isError(valid)) {
		return valid
	}
	const patch = pickDefined(input, [
		'name',
		'tenant_id',
		'site_group_id',
		'description',
		'comments',
		'physical_street',
		'physical_postcode',
		'physical_city',
		'shipping_street',
		'shipping_postcode',
		'shipping_city',
	])
	if (!isPatchEmpty(patch)) {
		const written = await tryWrite(() =>
			getDb().update(sites).set(patch).where(eq(sites.id, id)),
		)
		if (Result.isError(written)) {
			return written
		}
	}
	return await logUpdate('site', current.value, await getSite(id))
}

/**
 * Deletes a site with its attachments. Floor-plan data (its own plan's
 * content, areas linking to it elsewhere) needs `confirmFloorplan`.
 */
export async function deleteSite(
	id: number,
	confirmFloorplan = false,
): Promise<Result<SiteRow, Error>> {
	const current = await getSite(id)
	if (Result.isError(current)) {
		return current
	}
	const blocked = await checkNoDependents([
		[
			locations,
			eq(locations.site_id, id),
			'Site still has locations; move or delete them first',
		],
		[racks, eq(racks.site_id, id), 'Site still has racks; move or delete them first'],
	])
	if (Result.isError(blocked)) {
		return blocked
	}
	const floorplan = await checkFloorplanDelete({ site_id: id }, confirmFloorplan)
	if (Result.isError(floorplan)) {
		return floorplan
	}
	// Attachments go with their site; their files only after the commit.
	const deleted = await tryWrite(() =>
		withTransaction(async (): Promise<AttachmentRow[]> => {
			const removed = await deleteOwnerAttachments({ site_id: id })
			await getDb().delete(sites).where(eq(sites.id, id))
			return removed
		}),
	)
	if (Result.isError(deleted)) {
		return deleted
	}
	await removeAttachmentFiles(deleted.value)
	return await logDelete('site', current.value)
}

// ---------------------------------------------------------------------------
// Site groups (flat, no nesting; they bundle sites but own no inventory)
// ---------------------------------------------------------------------------

export interface SiteGroupListParams extends ListParams, TenantFilterParams {
	sort: 'name' | 'description'
	order: 'asc' | 'desc'
}

export function listSiteGroups(params: SiteGroupListParams): Promise<Page<SiteGroupRow>> {
	const where = and(
		searchCondition(params.search, [site_groups.name, site_groups.description]),
		...tenantConditions(site_groups.tenant_id, params),
	)
	const orderColumn = params.sort === 'description' ? site_groups.description : site_groups.name
	return pageRows(
		site_groups,
		where,
		[orderOf(orderColumn, params.order), asc(site_groups.id)],
		params,
	)
}

export function getSiteGroup(id: number): Promise<Result<SiteGroupRow, Error>> {
	return findById(site_groups, id, 'Site group not found')
}

export async function createSiteGroup(
	input: SiteGroupCreate,
): Promise<Result<SiteGroupRow, Error>> {
	const tenantCheck = await checkTenantExists(input.tenant_id)
	if (Result.isError(tenantCheck)) {
		return tenantCheck
	}
	const row: Omit<SiteGroupRow, 'id'> = {
		tenant_id: input.tenant_id ?? null,
		name: input.name,
		description: input.description ?? null,
		comments: input.comments ?? null,
	}
	const id = await tryWrite(async () =>
		insertedId(await getDb().insert(site_groups).values(row).returning({ id: site_groups.id })),
	)
	if (Result.isError(id)) {
		return id
	}
	return await logCreate('site_group', await getSiteGroup(id.value))
}

export async function updateSiteGroup(
	id: number,
	input: SiteGroupUpdate,
): Promise<Result<SiteGroupRow, Error>> {
	const current = await getSiteGroup(id)
	if (Result.isError(current)) {
		return current
	}
	const tenantCheck = await checkTenantExists(input.tenant_id)
	if (Result.isError(tenantCheck)) {
		return tenantCheck
	}
	const patch = pickDefined(input, ['name', 'tenant_id', 'description', 'comments'])
	if (!isPatchEmpty(patch)) {
		const written = await tryWrite(() =>
			getDb().update(site_groups).set(patch).where(eq(site_groups.id, id)),
		)
		if (Result.isError(written)) {
			return written
		}
	}
	return await logUpdate('site_group', current.value, await getSiteGroup(id))
}

export async function deleteSiteGroup(id: number): Promise<Result<SiteGroupRow, Error>> {
	const current = await getSiteGroup(id)
	if (Result.isError(current)) {
		return current
	}
	const blocked = await checkNoDependents([
		[
			sites,
			eq(sites.site_group_id, id),
			'Site group still has sites; move or delete them first',
		],
	])
	if (Result.isError(blocked)) {
		return blocked
	}
	const deleted = await tryWrite(() => getDb().delete(site_groups).where(eq(site_groups.id, id)))
	if (Result.isError(deleted)) {
		return deleted
	}
	return await logDelete('site_group', current.value)
}

// ---------------------------------------------------------------------------
// Locations
// ---------------------------------------------------------------------------

const LOCATION_DEPTH_EXCEEDED = `Location hierarchy is limited to ${MAX_LOCATION_DEPTH} levels`

export interface LocationListParams extends ListParams, TenantFilterParams {
	site?: number
	parent?: number
	sort: 'name' | 'description'
	order: 'asc' | 'desc'
}

export async function listLocations(params: LocationListParams): Promise<Page<LocationRow>> {
	const where = and(
		searchCondition(params.search, [locations.name, locations.description]),
		params.site ? eq(locations.site_id, params.site) : undefined,
		params.parent ? eq(locations.parent_id, params.parent) : undefined,
		...tenantConditions(locations.tenant_id, params),
	)
	const matching = await getDb().select().from(locations).where(where)
	const ordered = sortHierarchically(matching, params.sort, params.order)
	const offset = offsetOf(params)
	return pageOf(ordered.slice(offset, offset + params.limit), matching.length, params)
}

export function getLocation(id: number): Promise<Result<LocationRow, Error>> {
	return findById(locations, id, 'Location not found')
}

/** Parent links of every location in a site, for depth/cycle checks. */
function siteLocationTree(siteId: number): Promise<{ id: number; parent_id: number | null }[]> {
	return getDb()
		.select({ id: locations.id, parent_id: locations.parent_id })
		.from(locations)
		.where(eq(locations.site_id, siteId))
}

/**
 * Validates placing a location under `parentId` in a site: the parent must
 * exist in the site, and the result must respect the depth cap. When moving
 * an existing node (`nodeId`), the parent must not be the node or one of its
 * descendants, and the node's subtree counts toward the depth.
 */
async function checkLocationParent(
	siteId: number,
	parentId: number,
	nodeId?: number,
): Promise<Result<undefined, Error>> {
	const tree = await siteLocationTree(siteId)
	const parents = buildParentMap(tree)
	if (!parents.has(parentId)) {
		return Result.err(new NotFoundError('Parent location not found in this site'))
	}
	if (nodeId !== undefined && (parentId === nodeId || createsCycle(nodeId, parentId, parents))) {
		return Result.err(
			new ConflictError('Cannot set a location as its own parent or descendant'),
		)
	}
	const parentDepth = depthOf(parentId, parents)
	if (Result.isError(parentDepth)) {
		return Result.err(new ConflictError(parentDepth.error.message))
	}
	const subtreeDepth =
		nodeId === undefined ? 0 : maxDescendantOffset(nodeId, buildChildrenMap(tree))
	if (parentDepth.value + 1 + subtreeDepth > MAX_LOCATION_DEPTH) {
		return Result.err(new ConflictError(LOCATION_DEPTH_EXCEEDED))
	}
	return Result.ok(undefined)
}

export async function createLocation(input: LocationCreate): Promise<Result<LocationRow, Error>> {
	const site = await checkExists(sites, input.site_id, 'Site not found')
	if (Result.isError(site)) {
		return site
	}
	const tenantCheck = await checkTenantExists(input.tenant_id)
	if (Result.isError(tenantCheck)) {
		return tenantCheck
	}
	const parentId = input.parent_id ?? null
	if (parentId !== null) {
		const parent = await checkLocationParent(input.site_id, parentId)
		if (Result.isError(parent)) {
			return parent
		}
	}
	const row: Omit<LocationRow, 'id'> = {
		site_id: input.site_id,
		parent_id: parentId,
		tenant_id: input.tenant_id ?? null,
		name: input.name,
		type: input.type,
		description: input.description ?? null,
	}
	const id = await tryWrite(async () =>
		insertedId(await getDb().insert(locations).values(row).returning({ id: locations.id })),
	)
	if (Result.isError(id)) {
		return id
	}
	return await logCreate('location', await getLocation(id.value))
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
	const tenantCheck = await checkTenantExists(input.tenant_id)
	if (Result.isError(tenantCheck)) {
		return tenantCheck
	}
	const effectiveParent = input.parent_id !== undefined ? input.parent_id : node.parent_id
	if (effectiveParent !== null) {
		const parent = await checkLocationParent(node.site_id, effectiveParent, id)
		if (Result.isError(parent)) {
			return parent
		}
	}
	const patch = pickDefined(input, ['name', 'type', 'parent_id', 'tenant_id', 'description'])
	if (!isPatchEmpty(patch)) {
		// A new parent can take placed racks and devices out of a plan's scope.
		const written = await tryWrite(() =>
			withTransaction(async () => {
				await getDb().update(locations).set(patch).where(eq(locations.id, id))
				if (patch.parent_id !== undefined && patch.parent_id !== node.parent_id) {
					await prunePlacements()
				}
			}),
		)
		if (Result.isError(written)) {
			return written
		}
	}
	return await logUpdate('location', node, await getLocation(id))
}

/**
 * Deletes a location with its attachments. Floor-plan data (its own plan's
 * content, areas linking to it elsewhere) needs `confirmFloorplan`.
 */
export async function deleteLocation(
	id: number,
	confirmFloorplan = false,
): Promise<Result<LocationRow, Error>> {
	const current = await getLocation(id)
	if (Result.isError(current)) {
		return current
	}
	const blocked = await checkNoDependents([
		[
			locations,
			eq(locations.parent_id, id),
			'Location still has child locations; move or delete them first',
		],
		[racks, eq(racks.location_id, id), 'Location still has racks; move or delete them first'],
	])
	if (Result.isError(blocked)) {
		return blocked
	}
	const floorplan = await checkFloorplanDelete({ location_id: id }, confirmFloorplan)
	if (Result.isError(floorplan)) {
		return floorplan
	}
	// Attachments go with their location; their files only after the commit.
	const deleted = await tryWrite(() =>
		withTransaction(async (): Promise<AttachmentRow[]> => {
			const removed = await deleteOwnerAttachments({ location_id: id })
			await getDb().delete(locations).where(eq(locations.id, id))
			return removed
		}),
	)
	if (Result.isError(deleted)) {
		return deleted
	}
	await removeAttachmentFiles(deleted.value)
	return await logDelete('location', current.value)
}
