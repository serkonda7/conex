import { Result } from 'better-result'
import {
	and,
	asc,
	eq,
	getTableColumns,
	inArray,
	isNotNull,
	notExists,
	or,
	type SQL,
	sql,
} from 'drizzle-orm'
import type { PgTable } from 'drizzle-orm/pg-core'
import {
	LOCATION_TYPES,
	type LocationCreate,
	type LocationType,
	type LocationUpdate,
	MAX_LOCATION_DEPTH,
	type SiteCreate,
	type SiteGroupCreate,
	type SiteGroupUpdate,
	type SiteUpdate,
	type TenantBundle,
	type TenantBundleJson,
	type TenantCreate,
	type TenantGroupCreate,
	type TenantGroupUpdate,
	type TenantUpdate,
} from 'shared/src/schemas'
import {
	devices,
	employee_tenants,
	external_links,
	floorplan_areas,
	floorplan_placements,
	interfaces,
	locations,
	managed_bundles,
	racks,
	service_levels,
	site_groups,
	sites,
	tenant_bundles,
	tenant_groups,
	tenants,
	user_tenants,
	virtual_machines,
} from '../schema'
import {
	buildChildrenMap,
	buildParentMap,
	createsCycle,
	depthOf,
	maxDescendantOffset,
	sortHierarchically,
	withTreeLinks,
} from '../services/hierarchy'
import { removeAttachmentFiles } from '../storage'
import {
	type AttachmentRow,
	checkFloorplanDelete,
	deleteOwnerAttachments,
	inferOutletLocations,
	prunePlacements,
} from './attachments'
import { logCreate, logDelete, logUpdate } from './changelog'
import { getDb, withTransaction } from './connection'
import { ConflictError, DuplicateError, NotFoundError } from './errors'
import {
	checkExists,
	checkTenantExists,
	countWhere,
	errOf,
	exists,
	findById,
	insertedId,
	inTenants,
	isPatchEmpty,
	isTaken,
	type ListParams,
	offsetOf,
	orderOf,
	type Page,
	pageOf,
	pageRows,
	pickDefined,
	relatedValue,
	scopeCondition,
	searchCondition,
	type TenantFilterParams,
	tenantConditions,
	tryWrite,
} from './list'

export type { ListParams, Page } from './list'
export type TenantGroupRow = typeof tenant_groups.$inferSelect
export type TenantRow = typeof tenants.$inferSelect
/** A tenant with its contracted bundles, sorted by bundle name. */
export type TenantDetail = TenantRow & { bundles: TenantBundleJson[] }
export type SiteRow = typeof sites.$inferSelect
export type SiteGroupRow = typeof site_groups.$inferSelect
export type LocationRow = typeof locations.$inferSelect

/**
 * List row: `child_count` and `ancestor_ids` (root first) refer to the
 * filtered tree, so the client can collapse rows across pages.
 */
export type LocationListRow = LocationRow & {
	site_name: string
	tenant_name: string | null
	depth: number
	child_count: number
	ancestor_ids: number[]
}

export interface TenantListParams extends ListParams {
	/** Only tenants of these tenant groups. */
	group?: number[]
	sort: 'name' | 'customer_number' | 'group' | 'sites' | 'racks' | 'devices'
	order: 'asc' | 'desc'
	/**
	 * Tenant scope for scoped editors/viewers: restricts the list to these
	 * tenants only (tenants have no shared `NULL` row).
	 * `undefined` means unconstrained (admin or global user).
	 */
	scopeTenantIds?: readonly number[]
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
	sort: 'name' | 'description' | 'tenants'
	order: 'asc' | 'desc'
	/**
	 * Tenant scope for scoped editors/viewers: restricts the list to the
	 * groups containing one of these tenants. `undefined` means unconstrained.
	 */
	scopeTenantIds?: readonly number[]
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
		params.scopeTenantIds !== undefined
			? sql`${tenant_groups.id} IN (SELECT ${tenants.tenant_group_id} FROM ${tenants} WHERE ${inTenants(tenants.id, params.scopeTenantIds)})`
			: undefined,
	)
	const tenantCount = countWhere(tenants.tenant_group_id, tenant_groups.id)
	const orderColumn = {
		name: tenant_groups.name,
		description: tenant_groups.description,
		tenants: tenantCount,
	}[params.sort]
	return await pageRows(
		tenant_groups,
		where,
		[orderOf(orderColumn, params.order), asc(tenant_groups.name), asc(tenant_groups.id)],
		params,
		{ tenant_count: tenantCount },
	)
}

export function getTenantGroup(id: number): Promise<Result<TenantGroupRow, Error>> {
	return findById(tenant_groups, id, 'Tenant group not found')
}

/** Ids of the tenants in a group; 404 when the group does not exist. */
export async function resolveTenantGroupIds(groupId: number): Promise<Result<number[], Error>> {
	// One row per member, or a single null-tenant row for an empty group.
	const rows = await getDb()
		.select({ id: tenants.id })
		.from(tenant_groups)
		.leftJoin(tenants, eq(tenants.tenant_group_id, tenant_groups.id))
		.where(eq(tenant_groups.id, groupId))
	if (rows.length === 0) {
		return Result.err(new NotFoundError('Tenant group not found'))
	}
	return Result.ok(rows.flatMap((r) => r.id ?? []))
}

/** True when one of `tenantIds` belongs to the tenant group. */
export function tenantGroupHasAny(groupId: number, tenantIds: readonly number[]): Promise<boolean> {
	return exists(
		tenants,
		and(eq(tenants.tenant_group_id, groupId), inTenants(tenants.id, tenantIds)),
	)
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
			tenants.website,
			sql`jsonb_path_query_array(${tenants.emails}, '$[*].address')::text`,
			sql`jsonb_path_query_array(${tenants.phones}, '$[*].number')::text`,
		]),
		params.group ? inArray(tenants.tenant_group_id, params.group) : undefined,
		scopeCondition(tenants.id, params.scopeTenantIds),
	)
	// NetBox-style related-object counts for the list view, selected with
	// the page so this stays one statement instead of O(page size).
	const counts = {
		site_count: countWhere(sites.tenant_id, tenants.id),
		rack_count: countWhere(racks.tenant_id, tenants.id),
		device_count: countWhere(devices.tenant_id, tenants.id),
	}
	const orderColumn = {
		name: tenants.name,
		customer_number: tenants.customer_number,
		group: relatedValue(tenant_groups.name, tenant_groups.id, tenants.tenant_group_id),
		sites: counts.site_count,
		racks: counts.rack_count,
		devices: counts.device_count,
	}[params.sort]
	return await pageRows(
		tenants,
		where,
		[orderOf(orderColumn, params.order), asc(tenants.name), asc(tenants.id)],
		params,
		counts,
	)
}

async function bundlesOf(tenantId: number, bundleId?: number): Promise<TenantBundleJson[]> {
	return await getDb()
		.select({
			managed_bundle_id: tenant_bundles.managed_bundle_id,
			managed_bundle_name: managed_bundles.name,
			service_level_id: tenant_bundles.service_level_id,
			service_level_name: service_levels.name,
		})
		.from(tenant_bundles)
		.innerJoin(managed_bundles, eq(managed_bundles.id, tenant_bundles.managed_bundle_id))
		.innerJoin(service_levels, eq(service_levels.id, tenant_bundles.service_level_id))
		.where(
			and(
				eq(tenant_bundles.tenant_id, tenantId),
				bundleId === undefined ? undefined : eq(tenant_bundles.managed_bundle_id, bundleId),
			),
		)
		.orderBy(asc(managed_bundles.name))
}

export async function getTenant(id: number): Promise<Result<TenantDetail, Error>> {
	const row = await findById(tenants, id, 'Tenant not found')
	if (Result.isError(row)) {
		return row
	}
	return Result.ok({ ...row.value, bundles: await bundlesOf(id) })
}

/** The contract of `tenantId` for a bundle, if it has one. */
export async function tenantBundle(
	tenantId: number,
	bundleId: number,
): Promise<TenantBundleJson | null> {
	return (await bundlesOf(tenantId, bundleId))[0] ?? null
}

/** Every contract must point at an existing bundle and service level. */
async function checkBundles(
	bundles: TenantBundle[] | undefined,
): Promise<Result<undefined, Error>> {
	for (const bundle of bundles ?? []) {
		for (const guard of [
			await checkExists(
				managed_bundles,
				bundle.managed_bundle_id,
				'Managed bundle not found',
			),
			await checkExists(service_levels, bundle.service_level_id, 'Service level not found'),
		]) {
			if (Result.isError(guard)) {
				return guard
			}
		}
	}
	return Result.ok(undefined)
}

/** Replaces the bundle contracts of a tenant (caller runs it in a transaction). */
async function writeBundles(tenantId: number, bundles: TenantBundle[]): Promise<void> {
	await getDb().delete(tenant_bundles).where(eq(tenant_bundles.tenant_id, tenantId))
	if (bundles.length > 0) {
		await getDb()
			.insert(tenant_bundles)
			.values(bundles.map((b) => ({ tenant_id: tenantId, ...b })))
	}
}

/** FK and customer-number guards shared by tenant create/update. */
async function checkTenantInput(
	input: {
		tenant_group_id?: number | null
		customer_number?: string | null
		bundles?: TenantBundle[]
	},
	excludeTenantId?: number,
): Promise<Result<undefined, Error>> {
	const group = await checkExists(tenant_groups, input.tenant_group_id, 'Tenant group not found')
	if (Result.isError(group)) {
		return group
	}
	const bundles = await checkBundles(input.bundles)
	if (Result.isError(bundles)) {
		return bundles
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

export async function createTenant(input: TenantCreate): Promise<Result<TenantDetail, Error>> {
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
		comments: input.comments ?? null,
	}
	const id = await tryWrite(
		() =>
			withTransaction(async () => {
				const newId = insertedId(
					await getDb().insert(tenants).values(row).returning({ id: tenants.id }),
				)
				await writeBundles(newId, input.bundles)
				return newId
			}),
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
): Promise<Result<TenantDetail, Error>> {
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
		'comments',
	])
	const bundles = input.bundles
	if (!isPatchEmpty(patch) || bundles !== undefined) {
		const written = await tryWrite(
			() =>
				withTransaction(async () => {
					if (!isPatchEmpty(patch)) {
						await getDb().update(tenants).set(patch).where(eq(tenants.id, id))
					}
					if (bundles !== undefined) {
						await writeBundles(id, bundles)
					}
				}),
			duplicateTenantError,
		)
		if (Result.isError(written)) {
			return written
		}
	}
	return await logUpdate('tenant', current.value, await getTenant(id))
}

export async function deleteTenant(id: number): Promise<Result<TenantDetail, Error>> {
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
			employee_tenants,
			eq(employee_tenants.tenant_id, id),
			'Tenant still has employees; remove them from the tenant or delete them first',
		],
		[
			user_tenants,
			eq(user_tenants.tenant_id, id),
			'Tenant still has users; reassign them before deleting',
		],
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
	group?: number[]
	sort: 'name' | 'description' | 'tenant' | 'group'
	order: 'asc' | 'desc'
}

export function listSites(params: SiteListParams): Promise<Page<SiteRow>> {
	const where = and(
		searchCondition(params.search, [sites.name, sites.description]),
		params.group ? inArray(sites.site_group_id, params.group) : undefined,
		...tenantConditions(sites.tenant_id, params),
	)
	const orderColumn = {
		name: sites.name,
		description: sites.description,
		tenant: relatedValue(tenants.name, tenants.id, sites.tenant_id),
		group: relatedValue(site_groups.name, site_groups.id, sites.site_group_id),
	}[params.sort]
	return pageRows(
		sites,
		where,
		[orderOf(orderColumn, params.order), asc(sites.name), asc(sites.id)],
		params,
	)
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
	sort: 'name' | 'description' | 'tenant'
	order: 'asc' | 'desc'
}

export function listSiteGroups(params: SiteGroupListParams): Promise<Page<SiteGroupRow>> {
	const where = and(
		searchCondition(params.search, [site_groups.name, site_groups.description]),
		...tenantConditions(site_groups.tenant_id, params),
	)
	const orderColumn = {
		name: site_groups.name,
		description: site_groups.description,
		tenant: relatedValue(tenants.name, tenants.id, site_groups.tenant_id),
	}[params.sort]
	return pageRows(
		site_groups,
		where,
		[orderOf(orderColumn, params.order), asc(site_groups.name), asc(site_groups.id)],
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
	site?: number[]
	parent?: number
	type?: LocationType[]
	sort: 'name' | 'description' | 'type' | 'site' | 'tenant'
	order: 'asc' | 'desc'
}

export async function listLocations(params: LocationListParams): Promise<Page<LocationListRow>> {
	const where = and(
		searchCondition(params.search, [locations.name, locations.description]),
		params.site ? inArray(locations.site_id, params.site) : undefined,
		params.parent ? eq(locations.parent_id, params.parent) : undefined,
		params.type ? inArray(locations.type, params.type) : undefined,
		...tenantConditions(locations.tenant_id, params),
	)
	const matching = await getDb()
		.select({
			...getTableColumns(locations),
			site_name: sites.name,
			tenant_name: tenants.name,
		})
		.from(locations)
		.innerJoin(sites, eq(sites.id, locations.site_id))
		.leftJoin(tenants, eq(tenants.id, locations.tenant_id))
		.where(where)
	const ordered = sortHierarchically(
		matching,
		// Types sort in their natural order (building before floor before room).
		params.sort === 'type'
			? (l: (typeof matching)[number]): number => LOCATION_TYPES.indexOf(l.type)
			: params.sort === 'site'
				? 'site_name'
				: params.sort === 'tenant'
					? 'tenant_name'
					: params.sort,
		params.order,
	)
	const linked = withTreeLinks(ordered)
	const offset = offsetOf(params)
	return pageOf(linked.slice(offset, offset + params.limit), matching.length, params)
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
		// Placed outlets take their location from their plan, which follows.
		[
			interfaces,
			and(
				eq(interfaces.location_id, id),
				notExists(
					getDb()
						.select({ id: floorplan_placements.id })
						.from(floorplan_placements)
						.where(
							or(
								eq(floorplan_placements.interface_id, interfaces.id),
								and(
									isNotNull(interfaces.jack_id),
									eq(floorplan_placements.jack_id, interfaces.jack_id),
								),
							),
						),
				),
			) as SQL,
			'Location still has outlets; move them to another location first',
		],
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
			// Plans with an area of the location: their outlets there move on.
			const linked = await getDb()
				.selectDistinct({ id: floorplan_areas.attachment_id })
				.from(floorplan_areas)
				.where(eq(floorplan_areas.location_id, id))
			await getDb().delete(locations).where(eq(locations.id, id))
			await inferOutletLocations(linked.map((row) => row.id))
			return removed
		}),
	)
	if (Result.isError(deleted)) {
		return deleted
	}
	await removeAttachmentFiles(deleted.value)
	return await logDelete('location', current.value)
}
