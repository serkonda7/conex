/**
 * Tenancy API wrappers: typed tenants/sites/locations/site-groups calls
 * over the hono RPC client. Errors surface as `Result.err` with the server's
 * `{ error }` message, matching the auth wrappers in `api_auth.ts`.
 */
import type { Result } from 'better-result'
import type { LocationRow, SiteRow, TenantListItem, TenantRow } from 'server/src/db/tenancy'
import type {
	LocationCreate,
	LocationListQuery,
	LocationUpdate,
	Page,
	SiteCreate,
	SiteGroupCreate,
	SiteGroupListQuery,
	SiteGroupUpdate,
	SiteListQuery,
	SiteUpdate,
	TenantCreate,
	TenantListQuery,
	TenantUpdate,
} from 'shared/src/types'
import { client, getPage, to_query, to_result } from './api'
import { t, tp } from './i18n'

export type { LocationRow, SiteRow, TenantRow }

/** Tenant row for the list view, with NetBox-style related-object counts. */
export type TenantWithCounts = TenantListItem

// ---------------------------------------------------------------------------
// Tenants
// ---------------------------------------------------------------------------

export async function fetch_tenants(
	filters?: TenantFilters,
): Promise<Result<Page<TenantWithCounts>, Error>> {
	return getPage<TenantWithCounts>(
		client.tenants.$get({
			query: to_query({
				search: filters?.search ?? '',
				page: filters?.page ?? 1,
				limit: filters?.limit ?? 200,
				sort: filters?.sort ?? 'name',
				order: filters?.order ?? 'asc',
			}),
		}),
		tp('api.loadFailed', 2, { noun: tp('noun.tenant', 2) }),
	)
}

export type TenantSort = TenantListQuery['sort']

export type TenantFilters = Partial<TenantListQuery>

export type TenantCreateInput = TenantCreate

export async function create_tenant(input: TenantCreateInput): Promise<Result<TenantRow, Error>> {
	const res = await client.tenants.$post({
		json: {
			name: input.name,
			slug: input.slug,
			description: input.description || undefined,
			comments: input.comments || undefined,
		},
	})
	return to_result<TenantRow>(res, t('api.createFailed', { noun: tp('noun.tenant', 1) }))
}

export async function fetch_tenant(id: number): Promise<Result<TenantRow, Error>> {
	const res = await client.tenants[':id'].$get({ param: { id: String(id) } })
	return to_result<TenantRow>(res, tp('api.loadFailed', 1, { noun: tp('noun.tenant', 1) }))
}

export async function delete_tenant(id: number): Promise<Result<unknown, Error>> {
	const res = await client.tenants[':id'].$delete({ param: { id: String(id) } })
	return to_result<unknown>(res, t('api.deleteFailed', { noun: tp('noun.tenant', 1) }))
}

export type TenantUpdateInput = TenantUpdate

export async function update_tenant(
	id: number,
	patch: TenantUpdateInput,
): Promise<Result<TenantRow, Error>> {
	const res = await client.tenants[':id'].$patch({ param: { id: String(id) }, json: patch })
	return to_result<TenantRow>(res, t('api.updateFailed', { noun: tp('noun.tenant', 1) }))
}

// ---------------------------------------------------------------------------
// Sites
// ---------------------------------------------------------------------------

export type SiteSort = SiteListQuery['sort']

export type SiteFilters = Partial<SiteListQuery>

export type SiteCreateInput = SiteCreate

export type SiteUpdateInput = SiteUpdate

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
			query: to_query({
				search: filters?.search ?? '',
				page: filters?.page ?? 1,
				limit: filters?.limit ?? 200,
				tenant: filters?.tenant,
				group: filters?.group,
				sort: filters?.sort ?? 'name',
				order: filters?.order ?? 'asc',
			}),
		}),
		tp('api.loadFailed', 2, { noun: tp('noun.site', 2) }),
	)
}

export async function fetch_site(id: number): Promise<Result<SiteWithExtras, Error>> {
	const res = await client.sites[':id'].$get({ param: { id: String(id) } })
	return to_result<SiteWithExtras>(res, tp('api.loadFailed', 1, { noun: tp('noun.site', 1) }))
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
	return to_result<SiteRow>(res, t('api.createFailed', { noun: tp('noun.site', 1) }))
}

export async function update_site(
	id: number,
	patch: SiteUpdateInput,
): Promise<Result<SiteRow, Error>> {
	const res = await client.sites[':id'].$patch({
		param: { id: String(id) },
		json: patch,
	})
	return to_result<SiteRow>(res, t('api.updateFailed', { noun: tp('noun.site', 1) }))
}

export async function delete_site(id: number): Promise<Result<unknown, Error>> {
	const res = await client.sites[':id'].$delete({ param: { id: String(id) } })
	return to_result<unknown>(res, t('api.deleteFailed', { noun: tp('noun.site', 1) }))
}

// ---------------------------------------------------------------------------
// Locations
// ---------------------------------------------------------------------------

export type LocationSort = LocationListQuery['sort']

export type LocationFilters = Partial<LocationListQuery>

export type LocationCreateInput = LocationCreate

export type LocationUpdateInput = LocationUpdate

export async function fetch_locations(
	filters?: LocationFilters | number,
): Promise<Result<Page<LocationRow>, Error>> {
	const f: LocationFilters = typeof filters === 'number' ? { site: filters } : (filters ?? {})
	return getPage<LocationRow>(
		client.locations.$get({
			query: to_query({
				search: f.search ?? '',
				page: f.page ?? 1,
				limit: f.limit ?? 200,
				site: f.site,
				tenant: f.tenant,
				parent: f.parent,
				sort: f.sort ?? 'name',
				order: f.order ?? 'asc',
			}),
		}),
		tp('api.loadFailed', 2, { noun: tp('noun.location', 2) }),
	)
}

export async function fetch_location(id: number): Promise<Result<LocationRow, Error>> {
	const res = await client.locations[':id'].$get({ param: { id: String(id) } })
	return to_result<LocationRow>(res, tp('api.loadFailed', 1, { noun: tp('noun.location', 1) }))
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
	return to_result<LocationRow>(res, t('api.createFailed', { noun: tp('noun.location', 1) }))
}

export async function update_location(
	id: number,
	patch: LocationUpdateInput,
): Promise<Result<LocationRow, Error>> {
	const res = await client.locations[':id'].$patch({
		param: { id: String(id) },
		json: patch,
	})
	return to_result<LocationRow>(res, t('api.updateFailed', { noun: tp('noun.location', 1) }))
}

export async function delete_location(id: number): Promise<Result<unknown, Error>> {
	const res = await client.locations[':id'].$delete({ param: { id: String(id) } })
	return to_result<unknown>(res, t('api.deleteFailed', { noun: tp('noun.location', 1) }))
}

// ---------------------------------------------------------------------------
// Site groups
// ---------------------------------------------------------------------------

export interface SiteGroupRow {
	id: number
	tenant_id: number | null
	parent_id: number | null
	name: string
	slug: string
	description: string | null
	comments: string | null
}

export type SiteGroupSort = SiteGroupListQuery['sort']

export type SiteGroupFilters = Partial<SiteGroupListQuery>

export type SiteGroupCreateInput = SiteGroupCreate

export type SiteGroupUpdateInput = SiteGroupUpdate

export async function fetch_site_groups(
	filters?: SiteGroupFilters,
): Promise<Result<Page<SiteGroupRow>, Error>> {
	return getPage<SiteGroupRow>(
		client['site-groups'].$get({
			query: to_query({
				search: filters?.search ?? '',
				page: filters?.page ?? 1,
				limit: filters?.limit ?? 200,
				tenant: filters?.tenant,
				parent: filters?.parent,
				sort: filters?.sort ?? 'name',
				order: filters?.order ?? 'asc',
			}),
		}),
		tp('api.loadFailed', 2, { noun: tp('noun.siteGroup', 2) }),
	)
}

export async function fetch_site_group(id: number): Promise<Result<SiteGroupRow, Error>> {
	const res = await client['site-groups'][':id'].$get({ param: { id: String(id) } })
	return to_result<SiteGroupRow>(res, tp('api.loadFailed', 1, { noun: tp('noun.siteGroup', 1) }))
}

export async function create_site_group(
	input: SiteGroupCreateInput,
): Promise<Result<SiteGroupRow, Error>> {
	const res = await client['site-groups'].$post({
		json: {
			name: input.name,
			slug: input.slug,
			tenant_id: input.tenant_id,
			parent_id: input.parent_id,
			description: input.description || undefined,
			comments: input.comments || undefined,
		},
	})
	return to_result<SiteGroupRow>(res, t('api.createFailed', { noun: tp('noun.siteGroup', 1) }))
}

export async function update_site_group(
	id: number,
	patch: SiteGroupUpdateInput,
): Promise<Result<SiteGroupRow, Error>> {
	const res = await client['site-groups'][':id'].$patch({
		param: { id: String(id) },
		json: patch,
	})
	return to_result<SiteGroupRow>(res, t('api.updateFailed', { noun: tp('noun.siteGroup', 1) }))
}

export async function delete_site_group(id: number): Promise<Result<unknown, Error>> {
	const res = await client['site-groups'][':id'].$delete({ param: { id: String(id) } })
	return to_result<unknown>(res, t('api.deleteFailed', { noun: tp('noun.siteGroup', 1) }))
}
