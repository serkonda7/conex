import type { SavedLayoutEntryJson, SavedLayoutJson } from 'shared/src/schemas'
import { saved_layouts } from '../schema'
import { renameLayoutReferences } from './saved_filters'
import { type SavedListStore, savedListStore } from './saved_list'

/**
 * Saved layouts: the named column layouts of a DataTable, shared by all
 * users (managed via `routes/saved_layouts.ts`); see {@link savedListStore}.
 * Renaming one keeps the saved filters that reference it pointed at it;
 * deleting one leaves their reference dangling, which the client ignores.
 */
export const savedLayouts: SavedListStore<SavedLayoutJson, SavedLayoutEntryJson> = savedListStore({
	table: saved_layouts,
	column: 'layouts',
	noun: 'layout',
	toEntry: (layout: SavedLayoutJson): Pick<SavedLayoutEntryJson, 'layout'> => ({
		layout: layout.layout,
	}),
	// Saved filters reference layouts by name.
	renamed: renameLayoutReferences,
})
