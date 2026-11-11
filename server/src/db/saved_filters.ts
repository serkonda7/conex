import { Result } from 'better-result'
import { asc, eq } from 'drizzle-orm'
import type { SavedFilterEntryJson, SavedFilterJson, SavedFilterPageJson } from 'shared/src/schemas'
import { saved_filters } from '../schema'
import { nowSeconds } from '../util/time'
import { getDb } from './connection'
import { ConflictError, NotFoundError } from './errors'
import { type ListParams, offsetOf, pageOf, tryWrite } from './list'

// ---------------------------------------------------------------------------
// Saved filters: the named filter sets of a FilterTable, shared by all
// users (managed via `routes/saved_filters.ts`). A table's own save
// replaces its whole list; the overview edits or deletes single entries.
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

export interface SavedFilterListParams extends ListParams {
	table?: string[]
}

/**
 * One page of the saved filters of all (or the given) tables, ordered by
 * table key and then tab order. `search` matches the filter name. The
 * lists are small (at most 100 per table), so they are flattened here
 * instead of in SQL.
 */
export async function listSavedFilters(
	params: SavedFilterListParams,
): Promise<Result<SavedFilterPageJson, Error>> {
	const rows = await getDb().select().from(saved_filters).orderBy(asc(saved_filters.table_key))
	const tables = rows.filter((row) => row.filters.length > 0).map((row) => row.table_key)
	const wanted = params.table ? new Set(params.table) : null
	const needle = params.search.toLocaleLowerCase()
	const entries = rows.flatMap((row) =>
		wanted && !wanted.has(row.table_key)
			? []
			: row.filters.flatMap((filter, position): SavedFilterEntryJson[] =>
					filter.name.toLocaleLowerCase().includes(needle)
						? [
								{
									table: row.table_key,
									position,
									name: filter.name,
									values: filter.values,
									updated_at: row.updated_at,
								},
							]
						: [],
				),
	)
	const start = offsetOf(params)
	const page = pageOf(entries.slice(start, start + params.limit), entries.length, params)
	return Result.ok({ ...page, tables })
}

/**
 * Applies `change` to the filter at `position` of `table` in one
 * transaction (row locked). `expectedName` guards against a list that
 * changed since the client loaded it: a mismatch is a `ConflictError`.
 */
async function changeSavedFilter(
	table: string,
	position: number,
	expectedName: string,
	change: (filters: SavedFilterJson[]) => SavedFilterJson[],
): Promise<Result<SavedFilterJson[], Error>> {
	const result = await tryWrite(() =>
		getDb().transaction(async (tx): Promise<Result<SavedFilterJson[], Error>> => {
			const [row] = await tx
				.select({ filters: saved_filters.filters })
				.from(saved_filters)
				.where(eq(saved_filters.table_key, table))
				.for('update')
			const current = row?.filters[position]
			if (!row || !current) {
				return Result.err(new NotFoundError('Saved filter not found'))
			}
			if (current.name !== expectedName) {
				return Result.err(
					new ConflictError('The saved filters changed meanwhile; reload and try again'),
				)
			}
			const filters = change(row.filters)
			await tx
				.update(saved_filters)
				.set({ filters, updated_at: nowSeconds() })
				.where(eq(saved_filters.table_key, table))
			return Result.ok(filters)
		}),
	)
	return Result.isError(result) ? result : result.value
}

/** Replaces the filter at `position` of `table` (name and values). */
export async function updateSavedFilter(
	table: string,
	position: number,
	currentName: string,
	filter: SavedFilterJson,
): Promise<Result<SavedFilterJson[], Error>> {
	return changeSavedFilter(table, position, currentName, (filters) =>
		filters.map((f, i) => (i === position ? filter : f)),
	)
}

/** Removes the filter at `position` of `table`. */
export async function deleteSavedFilter(
	table: string,
	position: number,
	currentName: string,
): Promise<Result<SavedFilterJson[], Error>> {
	return changeSavedFilter(table, position, currentName, (filters) =>
		filters.filter((_, i) => i !== position),
	)
}
