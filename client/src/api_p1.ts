/**
 * P1 API wrappers: typed tenants/sites/locations calls over the hono
 * RPC client. Errors surface as `Result.err` with the server's `{ error }`
 * message, matching the auth wrappers in `api_auth.ts`.
 */
import type { Result } from 'better-result'
import type { LocationRow, SiteRow, TenantRow } from 'server/src/db/tenancy'
import { client, to_result } from './api'
import type { ApiResponse } from './util/api_error'

export interface Page<T> {
	items: T[]
	total: number
	page: number
	limit: number
}

export type { LocationRow, SiteRow, TenantRow }

async function getPage<T>(
	req: Promise<ApiResponse>,
	fallback: string,
): Promise<Result<Page<T>, Error>> {
	return to_result<Page<T>>(await req, fallback)
}

// ---------------------------------------------------------------------------
// Tenants
// ---------------------------------------------------------------------------

export async function fetch_tenants(): Promise<Result<Page<TenantRow>, Error>> {
	return getPage<TenantRow>(
		client.tenants.$get({ query: { search: '', page: '1', limit: '200' } }),
		'Failed to load tenants',
	)
}

export async function create_tenant(name: string, slug: string): Promise<Result<TenantRow, Error>> {
	const res = await client.tenants.$post({ json: { name, slug } })
	return to_result<TenantRow>(res, 'Failed to create tenant')
}

export async function delete_tenant(id: string): Promise<Result<unknown, Error>> {
	const res = await client.tenants[':id'].$delete({ param: { id } })
	return to_result<unknown>(res, 'Failed to delete tenant')
}

// ---------------------------------------------------------------------------
// Sites
// ---------------------------------------------------------------------------

export async function fetch_sites(tenant?: string): Promise<Result<Page<SiteRow>, Error>> {
	return getPage<SiteRow>(
		client.sites.$get({ query: { search: '', page: '1', limit: '200', tenant } }),
		'Failed to load sites',
	)
}

export async function fetch_site(id: string): Promise<Result<SiteRow, Error>> {
	const res = await client.sites[':id'].$get({ param: { id } })
	return to_result<SiteRow>(res, 'Failed to load site')
}

export async function create_site(
	name: string,
	slug: string,
	tenant_id: string | null,
): Promise<Result<SiteRow, Error>> {
	const res = await client.sites.$post({ json: { name, slug, tenant_id } })
	return to_result<SiteRow>(res, 'Failed to create site')
}

export async function delete_site(id: string): Promise<Result<unknown, Error>> {
	const res = await client.sites[':id'].$delete({ param: { id } })
	return to_result<unknown>(res, 'Failed to delete site')
}

// ---------------------------------------------------------------------------
// Locations
// ---------------------------------------------------------------------------

export async function fetch_locations(site: string): Promise<Result<Page<LocationRow>, Error>> {
	return getPage<LocationRow>(
		client.locations.$get({ query: { search: '', page: '1', limit: '200', site } }),
		'Failed to load locations',
	)
}

export async function create_location(
	name: string,
	slug: string,
	site_id: string,
	parent_id: string | null,
): Promise<Result<LocationRow, Error>> {
	const res = await client.locations.$post({ json: { name, slug, site_id, parent_id } })
	return to_result<LocationRow>(res, 'Failed to create location')
}

export async function delete_location(id: string): Promise<Result<unknown, Error>> {
	const res = await client.locations[':id'].$delete({ param: { id } })
	return to_result<unknown>(res, 'Failed to delete location')
}
