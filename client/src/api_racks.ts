/**
 * Racks API wrappers: typed racks/shelves/elevation calls over the hono RPC
 * client. Errors surface as `Result.err` with the server's `{ error }`
 * message, matching the auth wrappers in `api_auth.ts`.
 */
import type { Result } from 'better-result'
import type { RackRow, ShelfRow } from 'server/src/db/racks'
import type {
	ElevationResponse,
	Page,
	RackCreate,
	RackListQuery,
	RackUpdate,
	ShelfCreate,
} from 'shared/src/types'
import { client, getPage, to_query, to_result } from './api'

export type { ElevationResponse, RackRow, ShelfRow }

// ---------------------------------------------------------------------------
// Racks
// ---------------------------------------------------------------------------

export type RackSort = RackListQuery['sort']

export type RackFilters = Partial<RackListQuery>

export type RackCreateInput = RackCreate

export type RackUpdateInput = RackUpdate

export async function fetch_racks(filters?: RackFilters): Promise<Result<Page<RackRow>, Error>> {
	return getPage<RackRow>(
		client.racks.$get({
			query: to_query({
				search: filters?.search ?? '',
				page: 1,
				limit: 200,
				site: filters?.site,
				location: filters?.location,
				tenant: filters?.tenant,
				sort: filters?.sort ?? 'name',
				order: filters?.order ?? 'asc',
			}),
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
			site_id: input.site_id,
			location_id: input.location_id,
			tenant_id: input.tenant_id,
			rack_type_id: input.rack_type_id,
			description: input.description || undefined,
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
			query: to_query({
				search: '',
				page: 1,
				limit: 200,
				rack,
			}),
		}),
		'Failed to load shelves',
	)
}

/**
 * Shelf create body. `height_u` stays optional here even though the shared
 * output type marks it required: the server defaults it to 1.
 */
export type ShelfCreateInput = Omit<ShelfCreate, 'height_u'> & {
	height_u?: ShelfCreate['height_u']
}

export async function create_shelf(input: ShelfCreateInput): Promise<Result<ShelfRow, Error>> {
	const res = await client.shelves.$post({ json: input })
	return to_result<ShelfRow>(res, 'Failed to create shelf')
}

export async function delete_shelf(id: number): Promise<Result<unknown, Error>> {
	const res = await client.shelves[':id'].$delete({ param: { id: String(id) } })
	return to_result<unknown>(res, 'Failed to delete shelf')
}
