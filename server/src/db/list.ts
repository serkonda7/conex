import { Result } from 'better-result'
import {
	and,
	asc,
	count,
	desc,
	eq,
	type InferSelectModel,
	inArray,
	ne,
	or,
	type SQL,
	type SQLWrapper,
	sql,
} from 'drizzle-orm'
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core'
import { tenants } from '../schema'
import { getDb } from './connection'
import { DuplicateError, isUniqueViolation, NotFoundError } from './errors'

export interface Page<T> {
	items: T[]
	total: number
	page: number
	limit: number
}

export interface ListParams {
	search: string
	page: number
	limit: number
}

export function pageOf<T>(items: T[], total: number, params: ListParams): Page<T> {
	return { items, total, page: params.page, limit: params.limit }
}

export function offsetOf(params: ListParams): number {
	return (params.page - 1) * params.limit
}

/** LIKE pattern with `%`, `_` and `\` escaped so the search stays literal. */
export function searchPattern(raw: string): string {
	return `%${raw.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')}%`
}

/** Case-insensitive substring match on any of `columns`; `undefined` for an empty search. */
export function searchCondition(search: string, columns: SQLWrapper[]): SQL | undefined {
	if (!search) {
		return undefined
	}
	const pattern = searchPattern(search)
	return or(...columns.map((column) => sql`${column} ILIKE ${pattern} ESCAPE '\\'`))
}

/** Sort direction for a list `order` param. */
export function orderOf(column: SQLWrapper, order: 'asc' | 'desc'): SQL {
	return order === 'desc' ? desc(column) : asc(column)
}

/** One page of `table` rows plus the total match count. */
export async function pageRows<T extends PgTable>(
	table: T,
	where: SQL | undefined,
	orderBy: SQL[],
	params: ListParams,
): Promise<Page<InferSelectModel<T>>> {
	const db = getDb()
	const items = await db
		.select()
		.from(table as PgTable)
		.where(where)
		.orderBy(...orderBy)
		.limit(params.limit)
		.offset(offsetOf(params))
	const total = await db.$count(table, where)
	return pageOf(items as InferSelectModel<T>[], total, params)
}

/** Rows of `column`'s table per value in `ids`; ids without rows are absent. */
export async function countBy(column: PgColumn, ids: number[]): Promise<Map<number, number>> {
	if (ids.length === 0) {
		return new Map()
	}
	const rows = await getDb()
		.select({ id: column, n: count() })
		.from(column.table)
		.where(inArray(column, ids))
		.groupBy(column)
	return new Map(rows.map((r) => [r.id as number, r.n]))
}

/** True when a patch object carries no columns to write. */
export function isPatchEmpty(patch: object): boolean {
	return Object.keys(patch).length === 0
}

/** The `keys` of `input` that are set: the columns a PATCH body writes. */
export function pickDefined<T extends object, K extends keyof T>(
	input: T,
	keys: readonly K[],
): { [P in K]?: Exclude<T[P], undefined> } {
	const out: { [P in K]?: Exclude<T[P], undefined> } = {}
	for (const key of keys) {
		if (input[key] !== undefined) {
			out[key] = input[key] as Exclude<T[K], undefined>
		}
	}
	return out
}

/** Normalizes an unknown throw into an Error for `Result.err`. */
export function errOf(e: unknown): Error {
	return e instanceof Error ? e : new Error(String(e))
}

/**
 * Runs a write and returns its value as a `Result`. A unique violation maps
 * to `onUnique` (a message becomes a `DuplicateError`); anything else is
 * passed through as the error.
 */
export async function tryWrite<T>(
	write: () => Promise<T>,
	onUnique?: string | ((err: unknown) => Error),
): Promise<Result<T, Error>> {
	try {
		return Result.ok(await write())
	} catch (err) {
		if (onUnique !== undefined && isUniqueViolation(err)) {
			return Result.err(
				typeof onUnique === 'string' ? new DuplicateError(onUnique) : onUnique(err),
			)
		}
		return Result.err(errOf(err))
	}
}

/** Id of the row an `INSERT ... RETURNING id` produced; throws when there is none. */
export function insertedId(rows: { id: number }[]): number {
	const row = rows[0]
	if (!row) {
		throw new Error('Insert did not return an id')
	}
	return row.id
}

/** First row of `table` matching `where`. */
export async function findOne<T extends PgTable>(
	table: T,
	where: SQL | undefined,
): Promise<InferSelectModel<T> | undefined> {
	const rows = await getDb()
		.select()
		.from(table as PgTable)
		.where(where)
		.limit(1)
	return rows[0] as InferSelectModel<T> | undefined
}

type TableWithId = PgTable & { id: PgColumn }

/** Row of `table` by id, or a `NotFoundError` with `notFound` as message. */
export async function findById<T extends TableWithId>(
	table: T,
	id: number,
	notFound: string,
): Promise<Result<InferSelectModel<T>, Error>> {
	const row = await findOne(table, eq(table.id, id))
	return row ? Result.ok(row) : Result.err(new NotFoundError(notFound))
}

/** True when any row of `table` matches `where`. */
export async function exists(table: PgTable, where: SQL | undefined): Promise<boolean> {
	const rows = await getDb().select({ one: sql`1` }).from(table).where(where).limit(1)
	return rows.length > 0
}

/** True when a row other than `excludeId` matches `where` (unique-value guards). */
export async function isTaken(
	table: TableWithId,
	where: SQL | undefined,
	excludeId?: number,
): Promise<boolean> {
	return exists(table, and(where, excludeId === undefined ? undefined : ne(table.id, excludeId)))
}

/** Optional FK guard: null/undefined passes, a missing id is a `NotFoundError`. */
export async function checkExists(
	table: TableWithId,
	id: number | null | undefined,
	notFound: string,
): Promise<Result<undefined, Error>> {
	if (id === null || id === undefined || (await exists(table, eq(table.id, id)))) {
		return Result.ok(undefined)
	}
	return Result.err(new NotFoundError(notFound))
}

/** Shared tenant FK guard: null/undefined passes, missing id is 404. */
export function checkTenantExists(
	tenantId: number | null | undefined,
): Promise<Result<undefined, Error>> {
	return checkExists(tenants, tenantId, 'Tenant not found')
}

/**
 * Tenant filters shared by every tenant-bearing list. All present filters
 * intersect: an explicit `?tenant=`, a `?tenant_group=` resolved to its
 * member tenant ids, and the requester's scope (strict — shared `NULL`
 * rows are excluded).
 */
export interface TenantFilterParams {
	tenant?: number
	/** Member tenants of the requested tenant group; empty matches nothing. */
	tenantIds?: number[]
	/** Tenant scope of a scoped editor/viewer; `undefined` = unconstrained. */
	scopeTenantId?: number
}

/** WHERE conditions for `TenantFilterParams` on a row's `tenant_id` column. */
export function tenantConditions(column: PgColumn, params: TenantFilterParams): SQL[] {
	const conditions: SQL[] = []
	if (params.tenant !== undefined) {
		conditions.push(eq(column, params.tenant))
	}
	if (params.tenantIds !== undefined) {
		conditions.push(
			params.tenantIds.length > 0 ? inArray(column, params.tenantIds) : sql`false`,
		)
	}
	if (params.scopeTenantId !== undefined) {
		conditions.push(eq(column, params.scopeTenantId))
	}
	return conditions
}
