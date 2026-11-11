import type { Accessor } from 'solid-js'
import { fetch_saved_layouts, put_saved_layouts, type SavedLayoutJson } from '../api/saved_layouts'
import { use_saved_list } from './saved_list'

/**
 * Controlled `savedLayouts` state for a DataTable, persisted globally (for
 * all users) under the table key `table`; see {@link use_saved_list}.
 */
export function use_saved_layouts(table: string): {
	savedLayouts: Accessor<SavedLayoutJson[]>
	onSavedLayoutsChange: (next: SavedLayoutJson[]) => void
	error: Accessor<string | null>
} {
	const list = use_saved_list({
		fetch: () => fetch_saved_layouts(table),
		put: (next: SavedLayoutJson[]) => put_saved_layouts(table, next),
	})
	return { savedLayouts: list.items, onSavedLayoutsChange: list.onChange, error: list.error }
}
