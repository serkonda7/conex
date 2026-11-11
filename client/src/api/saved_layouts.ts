/**
 * Saved layouts API wrapper: the named DataTable column layouts of a table,
 * shared by all users. Same shape as the saved filters: a table's save
 * replaces its whole list; the management page lists them across tables
 * and edits or deletes single entries by table and position.
 */
import type { Result } from 'better-result'
import type {
	SavedFilterListQuery,
	SavedLayoutEntryJson,
	SavedLayoutJson,
	SavedLayoutPageJson,
} from 'shared/src/types'
import { client, failed, paging, to_query, to_result } from './client'

export type { SavedLayoutEntryJson, SavedLayoutJson, SavedLayoutPageJson }

export async function fetch_saved_layouts(
	table: string,
): Promise<Result<SavedLayoutJson[], Error>> {
	const res = await client['saved-layouts'][':table'].$get({ param: { table } })
	return to_result<SavedLayoutJson[]>(res, failed.list('noun.savedLayout'))
}

export async function put_saved_layouts(
	table: string,
	layouts: SavedLayoutJson[],
): Promise<Result<SavedLayoutJson[], Error>> {
	const res = await client['saved-layouts'][':table'].$put({ param: { table }, json: layouts })
	return to_result<SavedLayoutJson[]>(res, failed.update('noun.savedLayout'))
}

/** One page of the saved layouts of all tables (or of `table`). */
export async function fetch_all_saved_layouts(
	filters?: Partial<SavedFilterListQuery>,
): Promise<Result<SavedLayoutPageJson, Error>> {
	const res = await client['saved-layouts'].$get({
		query: to_query({ ...paging(filters), table: filters?.table }),
	})
	return to_result<SavedLayoutPageJson>(res, failed.list('noun.savedLayout'))
}

function entry_param(entry: SavedLayoutEntryJson): { table: string; position: string } {
	return { table: entry.table, position: String(entry.position) }
}

/** Replaces `entry` with `layout`; 409 when the table's list changed since `entry` was loaded. */
export async function update_saved_layout(
	entry: SavedLayoutEntryJson,
	layout: SavedLayoutJson,
): Promise<Result<SavedLayoutJson[], Error>> {
	const res = await client['saved-layouts'][':table'][':position'].$put({
		param: entry_param(entry),
		json: { current_name: entry.name, layout },
	})
	return to_result<SavedLayoutJson[]>(res, failed.update('noun.savedLayout'))
}

/** Deletes `entry`; 409 when the table's list changed since `entry` was loaded. */
export async function delete_saved_layout(
	entry: SavedLayoutEntryJson,
): Promise<Result<SavedLayoutJson[], Error>> {
	const res = await client['saved-layouts'][':table'][':position'].$delete({
		param: entry_param(entry),
		query: { name: entry.name },
	})
	return to_result<SavedLayoutJson[]>(res, failed.delete('noun.savedLayout'))
}
