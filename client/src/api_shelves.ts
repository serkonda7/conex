/**
 * Shelves API wrappers: typed shelf calls over the hono RPC client.
 * Errors surface as `Result.err` with the server's `{ error }` message,
 * matching the other wrappers in `api_*.ts`.
 */
import type { Result } from 'better-result'
import type { ShelfRow } from 'server/src/db/shelves'
import type { Page, ShelfCreate, ShelfListQuery, ShelfUpdate } from 'shared/src/types'
import { client, getPage, to_query, to_result } from './api'

/**
 * Wire shape of a shelf: the SQLite flags read as booleans, mirroring
 * `InterfaceJson` in `api_devices.ts`.
 */
export type ShelfRowJson = Omit<ShelfRow, 'mount_usable' | 'is_full_depth'> & {
	mount_usable: boolean
	is_full_depth: boolean
}

function to_shelf_json(row: ShelfRow): ShelfRowJson {
	return {
		...row,
		mount_usable: row.mount_usable !== 0,
		is_full_depth: row.is_full_depth !== 0,
	}
}

export type ShelfSort = ShelfListQuery['sort']

export type ShelfFilters = Partial<ShelfListQuery>

export type ShelfCreateInput = ShelfCreate

export type ShelfUpdateInput = ShelfUpdate

export async function fetch_shelves(
	filters?: ShelfFilters,
): Promise<Result<Page<ShelfRowJson>, Error>> {
	const page = await getPage<ShelfRow>(
		client.shelves.$get({
			query: to_query({
				search: filters?.search ?? '',
				page: 1,
				limit: 200,
				rack: filters?.rack,
				sort: filters?.sort ?? 'name',
				order: filters?.order ?? 'asc',
			}),
		}),
		'Failed to load shelves',
	)
	return page.map((p) => ({
		...p,
		items: p.items.map(to_shelf_json),
	}))
}

export async function fetch_shelf(id: number): Promise<Result<ShelfRowJson, Error>> {
	const res = await client.shelves[':id'].$get({ param: { id: String(id) } })
	const row = await to_result<ShelfRow>(res, 'Failed to load shelf')
	return row.map(to_shelf_json)
}

export async function create_shelf(input: ShelfCreateInput): Promise<Result<ShelfRowJson, Error>> {
	const res = await client.shelves.$post({
		json: {
			name: input.name,
			rack_id: input.rack_id,
			face: input.face,
			position_u: input.position_u,
			mount_height: input.mount_height,
			mount_usable: input.mount_usable,
			reserved_height: input.reserved_height,
			is_full_depth: input.is_full_depth,
			description: input.description || undefined,
		},
	})
	const row = await to_result<ShelfRow>(res, 'Failed to create shelf')
	return row.map(to_shelf_json)
}

export async function update_shelf(
	id: number,
	patch: ShelfUpdateInput,
): Promise<Result<ShelfRowJson, Error>> {
	const res = await client.shelves[':id'].$patch({
		param: { id: String(id) },
		json: patch,
	})
	const row = await to_result<ShelfRow>(res, 'Failed to update shelf')
	return row.map(to_shelf_json)
}

export async function delete_shelf(id: number): Promise<Result<unknown, Error>> {
	const res = await client.shelves[':id'].$delete({ param: { id: String(id) } })
	return to_result<unknown>(res, 'Failed to delete shelf')
}
