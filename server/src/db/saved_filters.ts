import { eq } from 'drizzle-orm'
import type { SavedFilterEntryJson, SavedFilterJson } from 'shared/src/schemas'
import { saved_filters } from '../schema'
import { nowSeconds } from '../util/time'
import type { DbHandle } from './connection'
import { type SavedListStore, savedListStore } from './saved_list'

/**
 * Saved filters: the named filter sets of a FilterTable, shared by all
 * users (managed via `routes/saved_filters.ts`); see {@link savedListStore}.
 */
export const savedFilters: SavedListStore<SavedFilterJson, SavedFilterEntryJson> = savedListStore({
	table: saved_filters,
	column: 'filters',
	noun: 'filter',
	toEntry: (filter: SavedFilterJson): Pick<SavedFilterEntryJson, 'values' | 'layout'> => ({
		values: filter.values,
		layout: filter.layout,
	}),
})

/**
 * Points the saved filters of `table` that reference the saved layout `from`
 * at its new name `to`; runs in the transaction `tx` of the layout rename.
 */
export async function renameLayoutReferences(
	tx: DbHandle,
	table: string,
	from: string,
	to: string,
): Promise<void> {
	const [row] = await tx
		.select({ filters: saved_filters.filters })
		.from(saved_filters)
		.where(eq(saved_filters.table_key, table))
		.for('update')
	if (!row?.filters.some((filter) => filter.layout === from)) {
		return
	}
	const filters = row.filters.map((filter) =>
		filter.layout === from ? { ...filter, layout: to } : filter,
	)
	await tx
		.update(saved_filters)
		.set({ filters, updated_at: nowSeconds() })
		.where(eq(saved_filters.table_key, table))
}
