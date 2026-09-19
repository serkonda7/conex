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

export async function fetch_sites(tenant?: number): Promise<Result<Page<SiteRow>, Error>> {
	return getPage<SiteRow>(
		client.sites.$get({
			query: {
				search: '',
				page: '1',
				limit: '200',
				tenant: tenant === undefined ? undefined : String(tenant),
			},
		}),
		'Failed to load sites',
	)
}

export async function fetch_site(id: number): Promise<Result<SiteRow, Error>> {
	const res = await client.sites[':id'].$get({ param: { id: String(id) } })
	return to_result<SiteRow>(res, 'Failed to load site')
}

export async function create_site(
	name: string,
	slug: string,
	tenant_id: number | null,
): Promise<Result<SiteRow, Error>> {
	const res = await client.sites.$post({ json: { name, slug, tenant_id } })
	return to_result<SiteRow>(res, 'Failed to create site')
}

export async function delete_site(id: number): Promise<Result<unknown, Error>> {
	const res = await client.sites[':id'].$delete({ param: { id: String(id) } })
	return to_result<unknown>(res, 'Failed to delete site')
}

// ---------------------------------------------------------------------------
// Locations
// ---------------------------------------------------------------------------

export async function fetch_locations(site: number): Promise<Result<Page<LocationRow>, Error>> {
	return getPage<LocationRow>(
		client.locations.$get({
			query: {
				search: '',
				page: '1',
				limit: '200',
				site: site === undefined ? undefined : String(site),
			},
		}),
		'Failed to load locations',
	)
}

export async function create_location(
	name: string,
	slug: string,
	site_id: number,
	parent_id: number | null,
): Promise<Result<LocationRow, Error>> {
	const res = await client.locations.$post({ json: { name, slug, site_id, parent_id } })
	return to_result<LocationRow>(res, 'Failed to create location')
}

export async function delete_location(id: number): Promise<Result<unknown, Error>> {
	const res = await client.locations[':id'].$delete({ param: { id: String(id) } })
	return to_result<unknown>(res, 'Failed to delete location')
}
