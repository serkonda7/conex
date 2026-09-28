import { Result } from 'better-result'
import { eq, inArray, type SQL, sql } from 'drizzle-orm'
import type { PgColumn } from 'drizzle-orm/pg-core'
import { tenants } from '../schema'
import { getDb } from './connection'
import { NotFoundError } from './errors'

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

/** True when a patch object carries no columns to write. */
export function isPatchEmpty(patch: object): boolean {
	return Object.keys(patch).length === 0
}

/** Normalizes an unknown throw into an Error for `Result.err`. */
export function errOf(e: unknown): Error {
	return e instanceof Error ? e : new Error(String(e))
}

/** Shared tenant FK guard: null/undefined passes, missing id is 404. */
export async function checkTenantExists(
	tenantId: number | null | undefined,
): Promise<Result<undefined, Error>> {
	if (tenantId === null || tenantId === undefined) {
		return Result.ok(undefined)
	}
	const tenant = (
		await getDb().select().from(tenants).where(eq(tenants.id, tenantId)).limit(1)
	)[0]
	if (!tenant) {
		return Result.err(new NotFoundError('Tenant not found'))
	}
	return Result.ok(undefined)
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
