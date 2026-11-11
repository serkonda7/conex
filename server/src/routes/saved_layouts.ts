import {
	SavedLayoutListSchema,
	type SavedLayoutUpdate,
	SavedLayoutUpdateSchema,
} from 'shared/src/schemas'
import { savedLayouts } from '../db/saved_layouts'
import { savedListApp } from './saved_list'

/** Saved DataTable column layouts per table; see {@link savedListApp}. */
export const savedLayoutsApp = savedListApp({
	store: savedLayouts,
	listSchema: SavedLayoutListSchema,
	updateSchema: SavedLayoutUpdateSchema,
	itemOf: (body: SavedLayoutUpdate): SavedLayoutUpdate['layout'] => body.layout,
})
