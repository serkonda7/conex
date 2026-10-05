/**
 * Tenancy API wrappers: typed tenants/sites/locations/site-groups calls
 * over the hono RPC client. Errors surface as `Result.err` with the server's
 * `{ error }` message.
 */
import type { Result } from 'better-result'
import type {
	LocationRow,
	SiteGroupRow,
	SiteRow,
	TenantGroupListItem,
	TenantGroupRow,
	TenantListItem,
	TenantRow,
} from 'server/src/db/tenancy'
import type {
	LocationCreate,
	LocationListQuery,
	LocationType,
	LocationUpdate,
	Page,
	SiteCreate,
	SiteGroupCreate,
	SiteGroupListQuery,
	SiteGroupUpdate,
	SiteListQuery,
	SiteUpdate,
	TenantCreate,
	TenantGroupCreate,
	TenantGroupListQuery,
	TenantGroupUpdate,
	TenantListQuery,
	TenantUpdate,
} from 'shared/src/types'
import { by_id, client, failed, getPage, paging, to_query, to_result } from './client'

export type {
	LocationRow,
	LocationType,
	SiteGroupRow,
	SiteRow,
	TenantGroupListItem,
	TenantGroupRow,
	TenantRow,
}

/** Tenant row for the list view, with NetBox-style related-object counts. */
export type TenantWithCounts = TenantListItem

// ---------------------------------------------------------------------------
// Tenant groups
// ---------------------------------------------------------------------------

export type TenantGroupSort = TenantGroupListQuery['sort']

export async function fetch_tenant_groups(
	filters?: Partial<TenantGroupListQuery>,
): Promise<Result<Page<TenantGroupListItem>, Error>> {
	return getPage<TenantGroupListItem>(
		client['tenant-groups'].$get({
			query: to_query({
				...paging(filters),
				sort: filters?.sort ?? 'name',
				order: filters?.order ?? 'asc',
			}),
		}),
		failed.list('noun.tenantGroup'),
	)
}

export async function fetch_tenant_group(id: number): Promise<Result<TenantGroupRow, Error>> {
	const res = await client['tenant-groups'][':id'].$get(by_id(id))
	return to_result<TenantGroupRow>(res, failed.load('noun.tenantGroup'))
}

export async function create_tenant_group(
	input: TenantGroupCreate,
): Promise<Result<TenantGroupRow, Error>> {
	const res = await client['tenant-groups'].$post({ json: input })
	return to_result<TenantGroupRow>(res, failed.create('noun.tenantGroup'))
}

export async function update_tenant_group(
	id: number,
	patch: TenantGroupUpdate,
): Promise<Result<TenantGroupRow, Error>> {
	const res = await client['tenant-groups'][':id'].$patch({ ...by_id(id), json: patch })
	return to_result<TenantGroupRow>(res, failed.update('noun.tenantGroup'))
}

export async function delete_tenant_group(id: number): Promise<Result<unknown, Error>> {
	const res = await client['tenant-groups'][':id'].$delete(by_id(id))
	return to_result<unknown>(res, failed.delete('noun.tenantGroup'))
}

// ---------------------------------------------------------------------------
// Tenants
// ---------------------------------------------------------------------------

export type TenantSort = TenantListQuery['sort']

export async function fetch_tenants(
	filters?: Partial<TenantListQuery>,
): Promise<Result<Page<TenantWithCounts>, Error>> {
	return getPage<TenantWithCounts>(
		client.tenants.$get({
			query: to_query({
				...paging(filters),
				group: filters?.group,
				sort: filters?.sort ?? 'name',
				order: filters?.order ?? 'asc',
			}),
		}),
		failed.list('noun.tenant'),
	)
}

export async function fetch_tenant(id: number): Promise<Result<TenantRow, Error>> {
	const res = await client.tenants[':id'].$get(by_id(id))
	return to_result<TenantRow>(res, failed.load('noun.tenant'))
}

export async function create_tenant(input: TenantCreate): Promise<Result<TenantRow, Error>> {
	const res = await client.tenants.$post({ json: input })
	return to_result<TenantRow>(res, failed.create('noun.tenant'))
}

export async function update_tenant(
	id: number,
	patch: TenantUpdate,
): Promise<Result<TenantRow, Error>> {
	const res = await client.tenants[':id'].$patch({ ...by_id(id), json: patch })
	return to_result<TenantRow>(res, failed.update('noun.tenant'))
}

export async function delete_tenant(id: number): Promise<Result<unknown, Error>> {
	const res = await client.tenants[':id'].$delete(by_id(id))
	return to_result<unknown>(res, failed.delete('noun.tenant'))
}

// ---------------------------------------------------------------------------
// Sites
// ---------------------------------------------------------------------------

export type SiteSort = SiteListQuery['sort']

export async function fetch_sites(
	filters?: Partial<SiteListQuery>,
): Promise<Result<Page<SiteRow>, Error>> {
	return getPage<SiteRow>(
		client.sites.$get({
			query: to_query({
				...paging(filters),
				tenant: filters?.tenant,
				tenant_group: filters?.tenant_group,
				group: filters?.group,
				sort: filters?.sort ?? 'name',
				order: filters?.order ?? 'asc',
			}),
		}),
		failed.list('noun.site'),
	)
}

export async function fetch_site(id: number): Promise<Result<SiteRow, Error>> {
	const res = await client.sites[':id'].$get(by_id(id))
	return to_result<SiteRow>(res, failed.load('noun.site'))
}

export async function create_site(input: SiteCreate): Promise<Result<SiteRow, Error>> {
	const res = await client.sites.$post({ json: input })
	return to_result<SiteRow>(res, failed.create('noun.site'))
}

export async function update_site(id: number, patch: SiteUpdate): Promise<Result<SiteRow, Error>> {
	const res = await client.sites[':id'].$patch({ ...by_id(id), json: patch })
	return to_result<SiteRow>(res, failed.update('noun.site'))
}

export async function delete_site(id: number): Promise<Result<unknown, Error>> {
	const res = await client.sites[':id'].$delete(by_id(id))
	return to_result<unknown>(res, failed.delete('noun.site'))
}

// ---------------------------------------------------------------------------
// Locations
// ---------------------------------------------------------------------------

export type LocationSort = LocationListQuery['sort']

/** `type` defaults to `other` server-side. */
export type LocationCreateInput = Omit<LocationCreate, 'type'> & { type?: LocationType }

export async function fetch_locations(
	filters?: Partial<LocationListQuery>,
): Promise<Result<Page<LocationRow>, Error>> {
	return getPage<LocationRow>(
		client.locations.$get({
			query: to_query({
				...paging(filters),
				site: filters?.site,
				tenant: filters?.tenant,
				tenant_group: filters?.tenant_group,
				parent: filters?.parent,
				sort: filters?.sort ?? 'name',
				order: filters?.order ?? 'asc',
			}),
		}),
		failed.list('noun.location'),
	)
}

export async function fetch_location(id: number): Promise<Result<LocationRow, Error>> {
	const res = await client.locations[':id'].$get(by_id(id))
	return to_result<LocationRow>(res, failed.load('noun.location'))
}

export async function create_location(
	input: LocationCreateInput,
): Promise<Result<LocationRow, Error>> {
	const res = await client.locations.$post({
		json: { ...input, tenant_id: input.tenant_id ?? null },
	})
	return to_result<LocationRow>(res, failed.create('noun.location'))
}

export async function update_location(
	id: number,
	patch: LocationUpdate,
): Promise<Result<LocationRow, Error>> {
	const res = await client.locations[':id'].$patch({ ...by_id(id), json: patch })
	return to_result<LocationRow>(res, failed.update('noun.location'))
}

export async function delete_location(id: number): Promise<Result<unknown, Error>> {
	const res = await client.locations[':id'].$delete(by_id(id))
	return to_result<unknown>(res, failed.delete('noun.location'))
}

// ---------------------------------------------------------------------------
// Site groups
// ---------------------------------------------------------------------------

export type SiteGroupSort = SiteGroupListQuery['sort']

export async function fetch_site_groups(
	filters?: Partial<SiteGroupListQuery>,
): Promise<Result<Page<SiteGroupRow>, Error>> {
	return getPage<SiteGroupRow>(
		client['site-groups'].$get({
			query: to_query({
				...paging(filters),
				tenant: filters?.tenant,
				tenant_group: filters?.tenant_group,
				sort: filters?.sort ?? 'name',
				order: filters?.order ?? 'asc',
			}),
		}),
		failed.list('noun.siteGroup'),
	)
}

export async function fetch_site_group(id: number): Promise<Result<SiteGroupRow, Error>> {
	const res = await client['site-groups'][':id'].$get(by_id(id))
	return to_result<SiteGroupRow>(res, failed.load('noun.siteGroup'))
}

export async function create_site_group(
	input: SiteGroupCreate,
): Promise<Result<SiteGroupRow, Error>> {
	const res = await client['site-groups'].$post({ json: input })
	return to_result<SiteGroupRow>(res, failed.create('noun.siteGroup'))
}

export async function update_site_group(
	id: number,
	patch: SiteGroupUpdate,
): Promise<Result<SiteGroupRow, Error>> {
	const res = await client['site-groups'][':id'].$patch({ ...by_id(id), json: patch })
	return to_result<SiteGroupRow>(res, failed.update('noun.siteGroup'))
}

export async function delete_site_group(id: number): Promise<Result<unknown, Error>> {
	const res = await client['site-groups'][':id'].$delete(by_id(id))
	return to_result<unknown>(res, failed.delete('noun.siteGroup'))
}
