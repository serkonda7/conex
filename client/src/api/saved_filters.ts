/**
 * Saved filters API wrapper: the named FilterTable filter sets of a table,
 * shared by all users. A save replaces the table's whole list.
 */
import type { Result } from 'better-result'
import type { SavedFilterJson } from 'shared/src/types'
import { client, failed, to_result } from './client'

export type { SavedFilterJson }

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
