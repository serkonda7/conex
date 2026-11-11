import { Result } from 'better-result'
import { asc, eq } from 'drizzle-orm'
import type { SavedLayoutEntryJson, SavedLayoutJson, SavedLayoutPageJson } from 'shared/src/schemas'
import { saved_layouts } from '../schema'
import { nowSeconds } from '../util/time'
import { getDb } from './connection'
import { ConflictError, NotFoundError } from './errors'
import { type ListParams, offsetOf, pageOf, tryWrite } from './list'

// ---------------------------------------------------------------------------
// Saved layouts: the named column layouts of a DataTable, shared by all
// users (managed via `routes/saved_layouts.ts`). Mirrors the saved filters:
// a table's own save replaces its whole list; the overview edits or deletes
// single entries.
// ---------------------------------------------------------------------------

/** Saved layouts of `table` in stored order; `[]` when none were saved yet. */
export async function getSavedLayouts(table: string): Promise<Result<SavedLayoutJson[], Error>> {
	const [row] = await getDb()
		.select({ layouts: saved_layouts.layouts })
		.from(saved_layouts)
		.where(eq(saved_layouts.table_key, table))
	return Result.ok(row?.layouts ?? [])
}

/** Replaces the saved layouts of `table`; returns the stored list. */
export async function putSavedLayouts(
	table: string,
	layouts: SavedLayoutJson[],
): Promise<Result<SavedLayoutJson[], Error>> {
	const updated_at = nowSeconds()
	return tryWrite(async () => {
		await getDb()
			.insert(saved_layouts)
			.values({ table_key: table, layouts, updated_at })
			.onConflictDoUpdate({ target: saved_layouts.table_key, set: { layouts, updated_at } })
		return layouts
	})
}

export interface SavedLayoutListParams extends ListParams {
	table?: string[]
}

/**
 * One page of the saved layouts of all (or the given) tables, ordered by
 * table key and then menu order. `search` matches the layout name. The
 * lists are small (at most 100 per table), so they are flattened here.
 */
export async function listSavedLayouts(
	params: SavedLayoutListParams,
): Promise<Result<SavedLayoutPageJson, Error>> {
	const rows = await getDb().select().from(saved_layouts).orderBy(asc(saved_layouts.table_key))
	const tables = rows.filter((row) => row.layouts.length > 0).map((row) => row.table_key)
	const wanted = params.table ? new Set(params.table) : null
	const needle = params.search.toLocaleLowerCase()
	const entries = rows.flatMap((row) =>
		wanted && !wanted.has(row.table_key)
			? []
			: row.layouts.flatMap((saved, position): SavedLayoutEntryJson[] =>
					saved.name.toLocaleLowerCase().includes(needle)
						? [
								{
									table: row.table_key,
									position,
									name: saved.name,
									layout: saved.layout,
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
 * Applies `change` to the layout at `position` of `table` in one
 * transaction (row locked). `expectedName` guards against a list that
 * changed since the client loaded it: a mismatch is a `ConflictError`.
 */
async function changeSavedLayout(
	table: string,
	position: number,
	expectedName: string,
	change: (layouts: SavedLayoutJson[]) => SavedLayoutJson[],
): Promise<Result<SavedLayoutJson[], Error>> {
	const result = await tryWrite(() =>
		getDb().transaction(async (tx): Promise<Result<SavedLayoutJson[], Error>> => {
			const [row] = await tx
				.select({ layouts: saved_layouts.layouts })
				.from(saved_layouts)
				.where(eq(saved_layouts.table_key, table))
				.for('update')
			const current = row?.layouts[position]
			if (!row || !current) {
				return Result.err(new NotFoundError('Saved layout not found'))
			}
			if (current.name !== expectedName) {
				return Result.err(
					new ConflictError('The saved layouts changed meanwhile; reload and try again'),
				)
			}
			const layouts = change(row.layouts)
			await tx
				.update(saved_layouts)
				.set({ layouts, updated_at: nowSeconds() })
				.where(eq(saved_layouts.table_key, table))
			return Result.ok(layouts)
		}),
	)
	return Result.isError(result) ? result : result.value
}

/** Replaces the layout at `position` of `table` (name and layout). */
export async function updateSavedLayout(
	table: string,
	position: number,
	currentName: string,
	layout: SavedLayoutJson,
): Promise<Result<SavedLayoutJson[], Error>> {
	return changeSavedLayout(table, position, currentName, (layouts) =>
		layouts.map((l, i) => (i === position ? layout : l)),
	)
}

/** Removes the layout at `position` of `table`. */
export async function deleteSavedLayout(
	table: string,
	position: number,
	currentName: string,
): Promise<Result<SavedLayoutJson[], Error>> {
	return changeSavedLayout(table, position, currentName, (layouts) =>
		layouts.filter((_, i) => i !== position),
	)
}
