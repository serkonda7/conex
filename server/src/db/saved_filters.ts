import { Result } from 'better-result'
import { eq } from 'drizzle-orm'
import type { SavedFilterJson } from 'shared/src/schemas'
import { saved_filters } from '../schema'
import { nowSeconds } from '../util/time'
import { getDb } from './connection'
import { tryWrite } from './list'

// ---------------------------------------------------------------------------
// Saved filters: the named filter sets of a FilterTable, shared by all
// users (managed via `routes/saved_filters.ts`). Each save replaces the
// table's whole list.
// ---------------------------------------------------------------------------

/** Saved filters of `table` in stored order; `[]` when none were saved yet. */
export async function getSavedFilters(table: string): Promise<Result<SavedFilterJson[], Error>> {
	const [row] = await getDb()
		.select({ filters: saved_filters.filters })
		.from(saved_filters)
		.where(eq(saved_filters.table_key, table))
	return Result.ok(row?.filters ?? [])
}

/** Replaces the saved filters of `table`; returns the stored list. */
export async function putSavedFilters(
	table: string,
	filters: SavedFilterJson[],
): Promise<Result<SavedFilterJson[], Error>> {
	const updated_at = nowSeconds()
	return tryWrite(async () => {
		await getDb()
			.insert(saved_filters)
			.values({ table_key: table, filters, updated_at })
			.onConflictDoUpdate({ target: saved_filters.table_key, set: { filters, updated_at } })
		return filters
	})
}
