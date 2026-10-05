/**
 * Shelves API wrappers: typed shelf calls over the hono RPC client.
 * Errors surface as `Result.err` with the server's `{ error }` message.
 */
import type { Result } from 'better-result'
import type { ShelfRow } from 'server/src/db/shelves'
import type { ShelfCreate, ShelfUpdate } from 'shared/src/types'
import { by_id, client, failed, to_result } from './client'

/**
 * Wire shape of a shelf: the 0/1 DB flags read as booleans, mirroring
 * `InterfaceJson` in `devices.ts`.
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

export async function fetch_shelf(id: number): Promise<Result<ShelfRowJson, Error>> {
	const res = await client.shelves[':id'].$get(by_id(id))
	const row = await to_result<ShelfRow>(res, failed.load('noun.shelf'))
	return row.map(to_shelf_json)
}

export async function create_shelf(input: ShelfCreate): Promise<Result<ShelfRowJson, Error>> {
	const res = await client.shelves.$post({ json: input })
	const row = await to_result<ShelfRow>(res, failed.create('noun.shelf'))
	return row.map(to_shelf_json)
}

export async function update_shelf(
	id: number,
	patch: ShelfUpdate,
): Promise<Result<ShelfRowJson, Error>> {
	const res = await client.shelves[':id'].$patch({ ...by_id(id), json: patch })
	const row = await to_result<ShelfRow>(res, failed.update('noun.shelf'))
	return row.map(to_shelf_json)
}

export async function delete_shelf(id: number): Promise<Result<unknown, Error>> {
	const res = await client.shelves[':id'].$delete(by_id(id))
	return to_result<unknown>(res, failed.delete('noun.shelf'))
}
