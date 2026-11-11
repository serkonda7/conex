import type { SavedFilterEntryJson, SavedFilterJson } from 'shared/src/schemas'
import { saved_filters } from '../schema'
import { type SavedListStore, savedListStore } from './saved_list'

/**
 * Saved filters: the named filter sets of a FilterTable, shared by all
 * users (managed via `routes/saved_filters.ts`); see {@link savedListStore}.
 */
export const savedFilters: SavedListStore<SavedFilterJson, SavedFilterEntryJson> = savedListStore({
	table: saved_filters,
	column: 'filters',
	noun: 'filter',
	toEntry: (filter: SavedFilterJson): Pick<SavedFilterEntryJson, 'values'> => ({
		values: filter.values,
	}),
})
