/**
 * P1 API wrappers: typed tenants/sites/locations calls over the hono
 * RPC client. Errors surface as `Result.err` with the server's `{ error }`
 * message, matching the auth wrappers in `api_auth.ts`.
 */
import type { Result } from 'better-result'
import type { LocationRow, SiteRow, TenantListItem, TenantRow } from 'server/src/db/tenancy'
import { client, to_result } from './api'
import type { ApiResponse } from './util/api_error'

export interface Page<T> {
	items: T[]
	total: number
	page: number
	limit: number
}

export type { LocationRow, SiteRow, TenantRow }

/** Tenant row for the list view, with NetBox-style related-object counts. */
export type TenantWithCounts = TenantListItem

async function getPage<T>(
	req: Promise<ApiResponse>,
	fallback: string,
): Promise<Result<Page<T>, Error>> {
	return to_result<Page<T>>(await req, fallback)
}

// ---------------------------------------------------------------------------
// Tenants
// ---------------------------------------------------------------------------

export async function fetch_tenants(
	filters?: TenantFilters,
): Promise<Result<Page<TenantWithCounts>, Error>> {
	return getPage<TenantWithCounts>(
		client.tenants.$get({
			query: {
				search: filters?.search ?? '',
				page: String(filters?.page ?? 1),
				limit: String(filters?.limit ?? 200),
				sort: filters?.sort ?? 'name',
				order: filters?.order ?? 'asc',
			},
		}),
		'Failed to load tenants',
	)
}

export type TenantSort = 'name' | 'slug' | 'description'

export interface TenantFilters {
	search?: string
	page?: number
	limit?: number
	sort?: TenantSort
	order?: 'asc' | 'desc'
}

export interface TenantCreateInput {
	name: string
	slug: string
	description?: string
	comments?: string
}

export async function create_tenant(input: TenantCreateInput): Promise<Result<TenantRow, Error>> {
	const res = await client.tenants.$post({
		json: {
			name: input.name,
			slug: input.slug,
			description: input.description || undefined,
			comments: input.comments || undefined,
		},
	})
	return to_result<TenantRow>(res, 'Failed to create tenant')
}

export async function fetch_tenant(id: number): Promise<Result<TenantRow, Error>> {
	const res = await client.tenants[':id'].$get({ param: { id: String(id) } })
	return to_result<TenantRow>(res, 'Failed to load tenant')
}

export async function delete_tenant(id: number): Promise<Result<unknown, Error>> {
	const res = await client.tenants[':id'].$delete({ param: { id: String(id) } })
	return to_result<unknown>(res, 'Failed to delete tenant')
}

export interface TenantUpdateInput {
	name?: string
	slug?: string
	description?: string | null
	comments?: string | null
}

export async function update_tenant(
	id: number,
	patch: TenantUpdateInput,
): Promise<Result<TenantRow, Error>> {
	const res = await client.tenants[':id'].$patch({ param: { id: String(id) }, json: patch })
	return to_result<TenantRow>(res, 'Failed to update tenant')
}

// ---------------------------------------------------------------------------
// Sites
// ---------------------------------------------------------------------------

export type SiteSort = 'name' | 'slug' | 'description'

export interface SiteFilters {
	search?: string
	page?: number
	limit?: number
	sort?: SiteSort
	order?: 'asc' | 'desc'
	tenant?: number
	group?: number
}

export interface SiteCreateInput {
	name: string
	slug: string
	tenant_id: number | null
	site_group_id: number | null
	description?: string
	comments?: string
	physical_address?: string
	shipping_address?: string
}

export interface SiteUpdateInput {
	name?: string
	slug?: string
	tenant_id?: number | null
	site_group_id?: number | null
	description?: string | null
	comments?: string | null
	physical_address?: string | null
	shipping_address?: string | null
}

/**
 * Site row plus the newer nullable text columns (comments, addresses) and
 * the site-group FK. Declared optional so the frontend compiles whether or
 * not the backend migration has landed yet.
 */
export type SiteWithExtras = SiteRow & {
	comments?: string | null
	physical_address?: string | null
	shipping_address?: string | null
	site_group_id?: number | null
	/** Legacy free-text group column, removed by the site-groups migration. */
	group?: string | null
}

export async function fetch_sites(filters?: SiteFilters): Promise<Result<Page<SiteRow>, Error>> {
	return getPage<SiteRow>(
		client.sites.$get({
			query: {
				search: filters?.search ?? '',
				page: String(filters?.page ?? 1),
				limit: String(filters?.limit ?? 200),
				tenant: filters?.tenant === undefined ? undefined : String(filters.tenant),
				group: filters?.group === undefined ? undefined : String(filters.group),
				sort: filters?.sort ?? 'name',
				order: filters?.order ?? 'asc',
			},
		}),
		'Failed to load sites',
	)
}

export async function fetch_site(id: number): Promise<Result<SiteWithExtras, Error>> {
	const res = await client.sites[':id'].$get({ param: { id: String(id) } })
	return to_result<SiteWithExtras>(res, 'Failed to load site')
}

export async function create_site(input: SiteCreateInput): Promise<Result<SiteRow, Error>> {
	const res = await client.sites.$post({
		json: {
			name: input.name,
			slug: input.slug,
			tenant_id: input.tenant_id,
			site_group_id: input.site_group_id,
			description: input.description || undefined,
			comments: input.comments || undefined,
			physical_address: input.physical_address || undefined,
			shipping_address: input.shipping_address || undefined,
		},
	})
	return to_result<SiteRow>(res, 'Failed to create site')
}

export async function update_site(
	id: number,
	patch: SiteUpdateInput,
): Promise<Result<SiteRow, Error>> {
	const res = await client.sites[':id'].$patch({
		param: { id: String(id) },
		json: patch,
	})
	return to_result<SiteRow>(res, 'Failed to update site')
}

export async function delete_site(id: number): Promise<Result<unknown, Error>> {
	const res = await client.sites[':id'].$delete({ param: { id: String(id) } })
	return to_result<unknown>(res, 'Failed to delete site')
}

// ---------------------------------------------------------------------------
// Locations
// ---------------------------------------------------------------------------

export interface LocationFilters {
	search?: string
	page?: number
	limit?: number
	site?: number
	tenant?: number
	parent?: number
}

export interface LocationCreateInput {
	name: string
	slug: string
	site_id: number
	parent_id: number | null
	tenant_id?: number | null
	description?: string
}

export interface LocationUpdateInput {
	name?: string
	slug?: string
	parent_id?: number | null
	tenant_id?: number | null
	description?: string | null
}

export async function fetch_locations(
	filters?: LocationFilters | number,
): Promise<Result<Page<LocationRow>, Error>> {
	const f: LocationFilters = typeof filters === 'number' ? { site: filters } : (filters ?? {})
	return getPage<LocationRow>(
		client.locations.$get({
			query: {
				search: f.search ?? '',
				page: String(f.page ?? 1),
				limit: String(f.limit ?? 200),
				site: f.site === undefined ? undefined : String(f.site),
				tenant: f.tenant === undefined ? undefined : String(f.tenant),
				parent: f.parent === undefined ? undefined : String(f.parent),
			},
		}),
		'Failed to load locations',
	)
}

export async function fetch_location(id: number): Promise<Result<LocationRow, Error>> {
	const res = await client.locations[':id'].$get({ param: { id: String(id) } })
	return to_result<LocationRow>(res, 'Failed to load location')
}

export async function create_location(
	input: LocationCreateInput,
): Promise<Result<LocationRow, Error>> {
	const res = await client.locations.$post({
		json: {
			name: input.name,
			slug: input.slug,
			site_id: input.site_id,
			parent_id: input.parent_id,
			tenant_id: input.tenant_id ?? null,
			description: input.description || undefined,
		},
	})
	return to_result<LocationRow>(res, 'Failed to create location')
}

export async function update_location(
	id: number,
	patch: LocationUpdateInput,
): Promise<Result<LocationRow, Error>> {
	const res = await client.locations[':id'].$patch({
		param: { id: String(id) },
		json: patch,
	})
	return to_result<LocationRow>(res, 'Failed to update location')
}

export async function delete_location(id: number): Promise<Result<unknown, Error>> {
	const res = await client.locations[':id'].$delete({ param: { id: String(id) } })
	return to_result<unknown>(res, 'Failed to delete location')
}

// ---------------------------------------------------------------------------
// Site groups
// ---------------------------------------------------------------------------

export interface SiteGroupRow {
	id: number
	parent_id: number | null
	name: string
	slug: string
	description: string | null
	comments: string | null
}

export type SiteGroupSort = 'name' | 'slug' | 'description'

export interface SiteGroupFilters {
	search?: string
	page?: number
	limit?: number
	sort?: SiteGroupSort
	order?: 'asc' | 'desc'
	parent?: number
}

export interface SiteGroupCreateInput {
	name: string
	slug: string
	parent_id: number | null
	description?: string
	comments?: string
}

export interface SiteGroupUpdateInput {
	name?: string
	slug?: string
	parent_id?: number | null
	description?: string | null
	comments?: string | null
}

export async function fetch_site_groups(
	filters?: SiteGroupFilters,
): Promise<Result<Page<SiteGroupRow>, Error>> {
	return getPage<SiteGroupRow>(
		client['site-groups'].$get({
			query: {
				search: filters?.search ?? '',
				page: String(filters?.page ?? 1),
				limit: String(filters?.limit ?? 200),
				parent: filters?.parent === undefined ? undefined : String(filters.parent),
				sort: filters?.sort ?? 'name',
				order: filters?.order ?? 'asc',
			},
		}),
		'Failed to load site groups',
	)
}

export async function fetch_site_group(id: number): Promise<Result<SiteGroupRow, Error>> {
	const res = await client['site-groups'][':id'].$get({ param: { id: String(id) } })
	return to_result<SiteGroupRow>(res, 'Failed to load site group')
}

export async function create_site_group(
	input: SiteGroupCreateInput,
): Promise<Result<SiteGroupRow, Error>> {
	const res = await client['site-groups'].$post({
		json: {
			name: input.name,
			slug: input.slug,
			parent_id: input.parent_id,
			description: input.description || undefined,
			comments: input.comments || undefined,
		},
	})
	return to_result<SiteGroupRow>(res, 'Failed to create site group')
}

export async function update_site_group(
	id: number,
	patch: SiteGroupUpdateInput,
): Promise<Result<SiteGroupRow, Error>> {
	const res = await client['site-groups'][':id'].$patch({
		param: { id: String(id) },
		json: patch,
	})
	return to_result<SiteGroupRow>(res, 'Failed to update site group')
}

export async function delete_site_group(id: number): Promise<Result<unknown, Error>> {
	const res = await client['site-groups'][':id'].$delete({ param: { id: String(id) } })
	return to_result<unknown>(res, 'Failed to delete site group')
}
