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

export async function fetch_racks(filters?: {
	site?: string
	location?: string
	tenant?: string
}): Promise<Result<Page<RackRow>, Error>> {
	return getPage<RackRow>(
		client.racks.$get({
			query: {
				search: '',
				page: '1',
				limit: '200',
				site: filters?.site,
				location: filters?.location,
				tenant: filters?.tenant,
			},
		}),
		'Failed to load racks',
	)
}

export async function fetch_rack(id: string): Promise<Result<RackRow, Error>> {
	const res = await client.racks[':id'].$get({ param: { id } })
	return to_result<RackRow>(res, 'Failed to load rack')
}

export async function fetch_elevation(id: string): Promise<Result<ElevationResponse, Error>> {
	const res = await client.racks[':id'].elevation.$get({ param: { id } })
	return to_result<ElevationResponse>(res, 'Failed to load rack elevation')
}

export async function create_rack(input: {
	name: string
	slug: string
	site_id: string
	location_id: string | null
	tenant_id: string | null
	height_u?: number
}): Promise<Result<RackRow, Error>> {
	const res = await client.racks.$post({ json: input })
	return to_result<RackRow>(res, 'Failed to create rack')
}

export async function delete_rack(id: string): Promise<Result<unknown, Error>> {
	const res = await client.racks[':id'].$delete({ param: { id } })
	return to_result<unknown>(res, 'Failed to delete rack')
}

// ---------------------------------------------------------------------------
// Shelves
// ---------------------------------------------------------------------------

export async function fetch_shelves(rack: string): Promise<Result<Page<ShelfRow>, Error>> {
	return getPage<ShelfRow>(
		client.shelves.$get({ query: { search: '', page: '1', limit: '200', rack } }),
		'Failed to load shelves',
	)
}

export async function create_shelf(input: {
	name: string
	rack_id: string
	position_u: number
	height_u?: number
}): Promise<Result<ShelfRow, Error>> {
	const res = await client.shelves.$post({ json: input })
	return to_result<ShelfRow>(res, 'Failed to create shelf')
}

export async function delete_shelf(id: string): Promise<Result<unknown, Error>> {
	const res = await client.shelves[':id'].$delete({ param: { id } })
	return to_result<unknown>(res, 'Failed to delete shelf')
}
