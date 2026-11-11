/**
 * Saved filters API wrapper: the named FilterTable filter sets of a table,
 * shared by all users. A table's save replaces its whole list; the
 * management page lists them across tables and edits or deletes single
 * entries by table and position.
 */
import type { Result } from 'better-result'
import type {
	SavedFilterEntryJson,
	SavedFilterJson,
	SavedFilterListQuery,
	SavedFilterPageJson,
} from 'shared/src/types'
import { client, failed, paging, to_query, to_result } from './client'

export type { SavedFilterEntryJson, SavedFilterJson, SavedFilterPageJson }

export async function fetch_saved_filters(
	table: string,
): Promise<Result<SavedFilterJson[], Error>> {
	const res = await client['saved-filters'][':table'].$get({ param: { table } })
	return to_result<SavedFilterJson[]>(res, failed.list('noun.savedFilter'))
}

export async function put_saved_filters(
	table: string,
	filters: SavedFilterJson[],
): Promise<Result<SavedFilterJson[], Error>> {
	const res = await client['saved-filters'][':table'].$put({ param: { table }, json: filters })
	return to_result<SavedFilterJson[]>(res, failed.update('noun.savedFilter'))
}

/** One page of the saved filters of all tables (or of `table`). */
export async function fetch_all_saved_filters(
	filters?: Partial<SavedFilterListQuery>,
): Promise<Result<SavedFilterPageJson, Error>> {
	const res = await client['saved-filters'].$get({
		query: to_query({ ...paging(filters), table: filters?.table }),
	})
	return to_result<SavedFilterPageJson>(res, failed.list('noun.savedFilter'))
}

function entry_param(entry: SavedFilterEntryJson): { table: string; position: string } {
	return { table: entry.table, position: String(entry.position) }
}

/** Replaces `entry` with `filter`; 409 when the table's list changed since `entry` was loaded. */
export async function update_saved_filter(
	entry: SavedFilterEntryJson,
	filter: SavedFilterJson,
): Promise<Result<SavedFilterJson[], Error>> {
	const res = await client['saved-filters'][':table'][':position'].$put({
		param: entry_param(entry),
		json: { current_name: entry.name, filter },
	})
	return to_result<SavedFilterJson[]>(res, failed.update('noun.savedFilter'))
}

/** Deletes `entry`; 409 when the table's list changed since `entry` was loaded. */
export async function delete_saved_filter(
	entry: SavedFilterEntryJson,
): Promise<Result<SavedFilterJson[], Error>> {
	const res = await client['saved-filters'][':table'][':position'].$delete({
		param: entry_param(entry),
		query: { name: entry.name },
	})
	return to_result<SavedFilterJson[]>(res, failed.delete('noun.savedFilter'))
}
