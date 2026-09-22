/**
 * P2 API wrappers: typed racks/shelves/elevation calls over the hono RPC
 * client. Errors surface as `Result.err` with the server's `{ error }`
 * message, matching the auth wrappers in `api_auth.ts`.
 */
import type { Result } from 'better-result'
import type { RackRow, ShelfRow } from 'server/src/db/racks'
import type { ElevationResponse } from 'shared/src/schemas'
import { client, to_result } from './api'
import type { ApiResponse } from './util/api_error'

export interface Page<T> {
	items: T[]
	total: number
	page: number
	limit: number
}

export type { ElevationResponse, RackRow, ShelfRow }

async function getPage<T>(
	req: Promise<ApiResponse>,
	fallback: string,
): Promise<Result<Page<T>, Error>> {
	return to_result<Page<T>>(await req, fallback)
}

// ---------------------------------------------------------------------------
// Racks
// ---------------------------------------------------------------------------

export type RackSort = 'name' | 'slug' | 'status'

export interface RackFilters {
	search?: string
	site?: number
	location?: number
	tenant?: number
	sort?: RackSort
	order?: 'asc' | 'desc'
}

export interface RackCreateInput {
	name: string
	slug: string
	site_id: number
	location_id: number | null
	tenant_id: number | null
	rack_type_id: number
	description?: string
	height_u?: number
}

export interface RackUpdateInput {
	name?: string
	slug?: string
	location_id?: number | null
	tenant_id?: number | null
	description?: string | null
	height_u?: number
}

export async function fetch_racks(filters?: RackFilters): Promise<Result<Page<RackRow>, Error>> {
	return getPage<RackRow>(
		client.racks.$get({
			query: {
				search: filters?.search ?? '',
				page: '1',
				limit: '200',
				site: filters?.site === undefined ? undefined : String(filters.site),
				location: filters?.location === undefined ? undefined : String(filters.location),
				tenant: filters?.tenant === undefined ? undefined : String(filters.tenant),
				sort: filters?.sort ?? 'name',
				order: filters?.order ?? 'asc',
			},
		}),
		'Failed to load racks',
	)
}

export async function fetch_rack(id: number): Promise<Result<RackRow, Error>> {
	const res = await client.racks[':id'].$get({ param: { id: String(id) } })
	return to_result<RackRow>(res, 'Failed to load rack')
}

export async function fetch_elevation(id: number): Promise<Result<ElevationResponse, Error>> {
	const res = await client.racks[':id'].elevation.$get({ param: { id: String(id) } })
	return to_result<ElevationResponse>(res, 'Failed to load rack elevation')
}

export async function create_rack(input: RackCreateInput): Promise<Result<RackRow, Error>> {
	const res = await client.racks.$post({
		json: {
			name: input.name,
			slug: input.slug,
			site_id: input.site_id,
			location_id: input.location_id,
			tenant_id: input.tenant_id,
			rack_type_id: input.rack_type_id,
			description: input.description || undefined,
			height_u: input.height_u,
		},
	})
	return to_result<RackRow>(res, 'Failed to create rack')
}

export async function update_rack(
	id: number,
	patch: RackUpdateInput,
): Promise<Result<RackRow, Error>> {
	const res = await client.racks[':id'].$patch({
		param: { id: String(id) },
		json: patch,
	})
	return to_result<RackRow>(res, 'Failed to update rack')
}

export async function delete_rack(id: number): Promise<Result<unknown, Error>> {
	const res = await client.racks[':id'].$delete({ param: { id: String(id) } })
	return to_result<unknown>(res, 'Failed to delete rack')
}

// ---------------------------------------------------------------------------
// Shelves
// ---------------------------------------------------------------------------

export async function fetch_shelves(rack: number): Promise<Result<Page<ShelfRow>, Error>> {
	return getPage<ShelfRow>(
		client.shelves.$get({
			query: {
				search: '',
				page: '1',
				limit: '200',
				rack: rack === undefined ? undefined : String(rack),
			},
		}),
		'Failed to load shelves',
	)
}

export async function create_shelf(input: {
	name: string
	rack_id: number
	position_u: number
	height_u?: number
}): Promise<Result<ShelfRow, Error>> {
	const res = await client.shelves.$post({ json: input })
	return to_result<ShelfRow>(res, 'Failed to create shelf')
}

export async function delete_shelf(id: number): Promise<Result<unknown, Error>> {
	const res = await client.shelves[':id'].$delete({ param: { id: String(id) } })
	return to_result<unknown>(res, 'Failed to delete shelf')
}
