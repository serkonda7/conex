import {
	SavedFilterListSchema,
	type SavedFilterUpdate,
	SavedFilterUpdateSchema,
} from 'shared/src/schemas'
import { savedFilters } from '../db/saved_filters'
import { savedListApp } from './saved_list'

/** Saved FilterTable filters per table; see {@link savedListApp}. */
export const savedFiltersApp = savedListApp({
	store: savedFilters,
	listSchema: SavedFilterListSchema,
	updateSchema: SavedFilterUpdateSchema,
	itemOf: (body: SavedFilterUpdate): SavedFilterUpdate['filter'] => body.filter,
})
