import { Result } from 'better-result'
import { asc, eq } from 'drizzle-orm'
import type { SavedListEntryBase, SavedListPageJson } from 'shared/src/schemas'
import type { saved_filters, saved_layouts } from '../schema'
import { nowSeconds } from '../util/time'
import { getDb } from './connection'
import { ConflictError, NotFoundError } from './errors'
import { type ListParams, offsetOf, pageOf, tryWrite } from './list'

// ---------------------------------------------------------------------------
// Saved lists: named per-table lists shared by all users (saved filters,
// saved layouts). Each table has one row whose jsonb column holds the whole
// ordered list. A table's own save replaces its whole list; the overview
// edits or deletes single entries by position, guarded by the name the
// client saw there.
// ---------------------------------------------------------------------------

type SavedListTable = typeof saved_filters | typeof saved_layouts

interface SavedListParams extends ListParams {
	table?: string[]
}

export interface SavedListStore<T extends { name: string }, E extends SavedListEntryBase> {
	/** Saved items of `table` in stored order; `[]` when none were saved yet. */
	get(table: string): Promise<Result<T[], Error>>
	/** Replaces the saved items of `table`; returns the stored list. */
	put(table: string, items: T[]): Promise<Result<T[], Error>>
	/**
	 * One page of the saved items of all (or the given) tables, ordered by
	 * table key and then stored order. `search` matches the item name. The
	 * lists are small (at most 100 per table), so they are flattened here
	 * instead of in SQL.
	 */
	list(params: SavedListParams): Promise<Result<SavedListPageJson<E>, Error>>
	/** Replaces the item at `position` of `table`. */
	update(
		table: string,
		position: number,
		currentName: string,
		item: T,
	): Promise<Result<T[], Error>>
	/** Removes the item at `position` of `table`. */
	delete(table: string, position: number, currentName: string): Promise<Result<T[], Error>>
}

/**
 * The store of one saved-list table. `column` names its jsonb list column,
 * `noun` the item in error messages, and `toEntry` copies an item's payload
 * into its overview entry.
 */
export function savedListStore<T extends { name: string }, E extends SavedListEntryBase>(opts: {
	table: SavedListTable
	column: 'filters' | 'layouts'
	noun: string
	toEntry: (item: T) => Omit<E, keyof SavedListEntryBase>
}): SavedListStore<T, E> {
	// Both tables share the shape `{ table_key, <column>, updated_at }`; the
	// casts below only bridge the differently named list column.
	const table = opts.table as typeof saved_filters
	const itemsColumn = table[opts.column as 'filters']
	const itemsOf = (row: Record<string, unknown>): T[] => row[opts.column] as T[]
	const withItems = (items: T[]): { filters: never } =>
		({ [opts.column]: items }) as { filters: never }

	async function get(key: string): Promise<Result<T[], Error>> {
		const [row] = await getDb()
			.select({ items: itemsColumn })
			.from(table)
			.where(eq(table.table_key, key))
		return Result.ok((row?.items as unknown as T[] | undefined) ?? [])
	}

	async function put(key: string, items: T[]): Promise<Result<T[], Error>> {
		const updated_at = nowSeconds()
		return tryWrite(async () => {
			await getDb()
				.insert(table)
				.values({ table_key: key, ...withItems(items), updated_at })
				.onConflictDoUpdate({
					target: table.table_key,
					set: { ...withItems(items), updated_at },
				})
			return items
		})
	}

	async function list(params: SavedListParams): Promise<Result<SavedListPageJson<E>, Error>> {
		const rows = await getDb().select().from(table).orderBy(asc(table.table_key))
		const tables = rows.filter((row) => itemsOf(row).length > 0).map((row) => row.table_key)
		const wanted = params.table ? new Set(params.table) : null
		const needle = params.search.toLocaleLowerCase()
		const entries = rows.flatMap((row) =>
			wanted && !wanted.has(row.table_key)
				? []
				: itemsOf(row).flatMap((item, position): E[] =>
						item.name.toLocaleLowerCase().includes(needle)
							? [
									{
										...opts.toEntry(item),
										table: row.table_key,
										position,
										name: item.name,
										updated_at: row.updated_at,
									} as E,
								]
							: [],
					),
		)
		const start = offsetOf(params)
		const page = pageOf(entries.slice(start, start + params.limit), entries.length, params)
		return Result.ok({ ...page, tables })
	}

	/**
	 * Applies `change` to the item at `position` of `key` in one transaction
	 * (row locked). `expectedName` guards against a list that changed since
	 * the client loaded it: a mismatch is a `ConflictError`.
	 */
	async function change(
		key: string,
		position: number,
		expectedName: string,
		apply: (items: T[]) => T[],
	): Promise<Result<T[], Error>> {
		const result = await tryWrite(() =>
			getDb().transaction(async (tx): Promise<Result<T[], Error>> => {
				const [row] = await tx
					.select({ items: itemsColumn })
					.from(table)
					.where(eq(table.table_key, key))
					.for('update')
				const items = row?.items as unknown as T[] | undefined
				const current = items?.[position]
				if (!items || !current) {
					return Result.err(new NotFoundError(`Saved ${opts.noun} not found`))
				}
				if (current.name !== expectedName) {
					return Result.err(
						new ConflictError(
							`The saved ${opts.noun}s changed meanwhile; reload and try again`,
						),
					)
				}
				const next = apply(items)
				await tx
					.update(table)
					.set({ ...withItems(next), updated_at: nowSeconds() })
					.where(eq(table.table_key, key))
				return Result.ok(next)
			}),
		)
		return Result.isError(result) ? result : result.value
	}

	function update(
		key: string,
		position: number,
		currentName: string,
		item: T,
	): Promise<Result<T[], Error>> {
		return change(key, position, currentName, (items) =>
			items.map((old, i) => (i === position ? item : old)),
		)
	}

	function remove(
		key: string,
		position: number,
		currentName: string,
	): Promise<Result<T[], Error>> {
		return change(key, position, currentName, (items) => items.filter((_, i) => i !== position))
	}

	return { get, put, list, update, delete: remove }
}
