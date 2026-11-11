import type { Accessor } from 'solid-js'
import { fetch_saved_filters, put_saved_filters, type SavedFilterJson } from '../api/saved_filters'
import { use_saved_list } from './saved_list'

/**
 * Controlled `savedFilters` state for a FilterTable, persisted globally (for
 * all users) under the table key `table`; see {@link use_saved_list}.
 */
export function use_saved_filters(table: string): {
	savedFilters: Accessor<SavedFilterJson[]>
	onSavedFiltersChange: (next: SavedFilterJson[]) => void
	error: Accessor<string | null>
} {
	const list = use_saved_list({
		fetch: () => fetch_saved_filters(table),
		put: (next: SavedFilterJson[]) => put_saved_filters(table, next),
	})
	return { savedFilters: list.items, onSavedFiltersChange: list.onChange, error: list.error }
}
