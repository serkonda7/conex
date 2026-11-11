import type { SavedLayoutEntryJson, SavedLayoutJson } from 'shared/src/schemas'
import { saved_layouts } from '../schema'
import { type SavedListStore, savedListStore } from './saved_list'

/**
 * Saved layouts: the named column layouts of a DataTable, shared by all
 * users (managed via `routes/saved_layouts.ts`); see {@link savedListStore}.
 */
export const savedLayouts: SavedListStore<SavedLayoutJson, SavedLayoutEntryJson> = savedListStore({
	table: saved_layouts,
	column: 'layouts',
	noun: 'layout',
	toEntry: (layout: SavedLayoutJson): Pick<SavedLayoutEntryJson, 'layout'> => ({
		layout: layout.layout,
	}),
})
