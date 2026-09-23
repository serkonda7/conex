import { Result } from 'better-result'
import { eq } from 'drizzle-orm'
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
export function checkTenantExists(tenantId: number | null | undefined): Result<undefined, Error> {
	if (tenantId === null || tenantId === undefined) {
		return Result.ok(undefined)
	}
	const tenant = getDb().select().from(tenants).where(eq(tenants.id, tenantId)).get()
	if (!tenant) {
		return Result.err(new NotFoundError('Tenant not found'))
	}
	return Result.ok(undefined)
}
