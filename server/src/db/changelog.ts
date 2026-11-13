import { AsyncLocalStorage } from 'node:async_hooks'
import { Result } from 'better-result'
import { and, desc, inArray, lte } from 'drizzle-orm'
import type { ChangeAction, ChangeObjectType, ObjectChangeJson } from 'shared/src/schemas'
import { object_changes } from '../schema'
import { nowSeconds } from '../util/time'
import { getDb } from './connection'
import {
	findById,
	type ListParams,
	type Page,
	pageRows,
	searchCondition,
	type TenantFilterParams,
	tenantConditions,
} from './list'
import { cableTenants, deviceTenant, ownerTenant, rackTenant } from './owners'

/** Changes older than this are dropped by the periodic session sweep. */
const CHANGELOG_RETENTION_S = 365 * 24 * 60 * 60

/** Who a change is attributed to; set per request by `authMiddleware`. */
export interface ChangeActor {
	user_id: number
	username: string
	request_id: string
}

const actorStore = new AsyncLocalStorage<ChangeActor>()

/** Runs `fn` with every change it records attributed to `actor`. */
export function runAsActor<T>(actor: ChangeActor, fn: () => Promise<T>): Promise<T> {
	return actorStore.run(actor, fn)
}

type Snapshot = { id: number }

/** Fixed object type, or derived from the row for tables holding several kinds. */
type ObjectTypeOf<T> = ChangeObjectType | ((row: T) => ChangeObjectType)

function resolveType<T>(objectType: ObjectTypeOf<T>, row: T): ChangeObjectType {
	return typeof objectType === 'function' ? objectType(row) : objectType
}

/** Display name of an object: its name, model, label or file name, else `#id`. */
function reprOf(row: Snapshot): string {
	for (const key of ['name', 'model', 'label', 'filename']) {
		const value = (row as Record<string, unknown>)[key]
		if (typeof value === 'string' && value !== '') {
			return value
		}
	}
	return `#${row.id}`
}

/** Shares parent tenant lookups between the rows of one batch. */
type TenantCache = Map<string, Promise<number | null | undefined>>

/**
 * Tenant whose scoped users may see the change: the tenant itself, the
 * row's `tenant_id`, or the parent's for tenant-less children. A cable
 * belongs to a tenant only when both ends do (the cable read rule).
 * Catalog data has none. Parent lookups go through `cache`, so rows of one
 * batch with the same parent query it once.
 */
async function tenantOf(
	objectType: ChangeObjectType,
	row: Snapshot,
	cache: TenantCache,
): Promise<number | null> {
	const fields = row as Record<string, unknown>
	const ref = (key: string): number | null =>
		typeof fields[key] === 'number' ? (fields[key] as number) : null
	const cached = async (
		key: string,
		load: () => Promise<number | null | undefined>,
	): Promise<number | null> => {
		let tenant = cache.get(key)
		if (!tenant) {
			tenant = load()
			cache.set(key, tenant)
		}
		return (await tenant) ?? null
	}
	switch (objectType) {
		case 'tenant':
			return row.id
		// Primary tenant: a change log entry carries one tenant.
		case 'employee': {
			const ids = fields.tenant_ids
			return Array.isArray(ids) && typeof ids[0] === 'number' ? ids[0] : null
		}
		case 'site_group':
		case 'site':
		case 'location':
		case 'rack':
		case 'device':
		case 'virtual_machine':
			return ref('tenant_id')
		case 'attachment': {
			const owner = {
				site_id: ref('site_id'),
				location_id: ref('location_id'),
				rack_id: ref('rack_id'),
			}
			return cached(`owner:${owner.site_id}:${owner.location_id}:${owner.rack_id}`, () =>
				ownerTenant(owner),
			)
		}
		case 'shelf': {
			const rack = ref('rack_id')
			return rack === null ? null : cached(`rack:${rack}`, () => rackTenant(rack))
		}
		case 'interface':
		case 'panel_jack': {
			const device = ref('device_id')
			return device === null ? null : cached(`device:${device}`, () => deviceTenant(device))
		}
		case 'cable': {
			const a = ref('a_interface_id')
			const b = ref('b_interface_id')
			if (a === null || b === null) {
				return null
			}
			return cached(`cable:${a}:${b}`, async () => {
				const [tenantA, tenantB] = await cableTenants({
					a_interface_id: a,
					b_interface_id: b,
				})
				return tenantA === tenantB ? tenantA : null
			})
		}
		default:
			return null
	}
}

/** One change to record: `before` is null for a creation, `after` for a deletion. */
export interface Change {
	action: ChangeAction
	objectType: ChangeObjectType
	before: Snapshot | null
	after: Snapshot | null
}

/**
 * Appends changes in the given order with one INSERT, resolving each
 * parent's tenant once. Runs on the caller's `getDb()`, so inside
 * `withTransaction` it commits or rolls back with the change itself. A
 * failed write is logged but never fails the change.
 */
export async function logChanges(changes: Change[]): Promise<void> {
	const actor = actorStore.getStore()
	try {
		const cache: TenantCache = new Map()
		const rows: (typeof object_changes.$inferInsert)[] = []
		for (const { action, objectType, before, after } of changes) {
			const subject = after ?? before
			if (!subject) {
				continue
			}
			// A patch that changed nothing is not a change.
			if (before && after && JSON.stringify(before) === JSON.stringify(after)) {
				continue
			}
			rows.push({
				created_at: nowSeconds(),
				user_id: actor?.user_id ?? null,
				username: actor?.username ?? '',
				request_id: actor?.request_id ?? null,
				action,
				object_type: objectType,
				object_id: subject.id,
				object_repr: reprOf(subject),
				tenant_id: await tenantOf(objectType, subject, cache),
				prechange_data: before,
				postchange_data: after,
			})
		}
		if (rows.length > 0) {
			// Ids follow the VALUES order, keeping the order of `changes`.
			await getDb().insert(object_changes).values(rows)
		}
	} catch (e) {
		console.error('Failed to write changelog entry:', e)
	}
}

/** Records a creation when `result` succeeded; returns `result` unchanged. */
export async function logCreate<T extends Snapshot>(
	objectType: ObjectTypeOf<T>,
	result: Result<T, Error>,
): Promise<Result<T, Error>> {
	if (Result.isOk(result)) {
		await logCreates(objectType, [result.value])
	}
	return result
}

/** Records an update from `before` to the successful `result`; returns `result`. */
export async function logUpdate<T extends Snapshot>(
	objectType: ObjectTypeOf<T>,
	before: T,
	result: Result<T, Error>,
): Promise<Result<T, Error>> {
	if (Result.isOk(result)) {
		await logUpdates(objectType, [[before, result.value]])
	}
	return result
}

/** Records the deletion of `before`; returns it as the delete result. */
export async function logDelete<T extends Snapshot>(
	objectType: ObjectTypeOf<T>,
	before: T,
): Promise<Result<T, Error>> {
	await logDeletes(objectType, [before])
	return Result.ok(before)
}

/** Creation entries for `rows`, in order. */
export function createChanges<T extends Snapshot>(
	objectType: ObjectTypeOf<T>,
	rows: T[],
): Change[] {
	return rows.map((row) => ({
		action: 'create',
		objectType: resolveType(objectType, row),
		before: null,
		after: row,
	}))
}

/** Update entries for `[before, after]` pairs, in order. */
export function updateChanges<T extends Snapshot>(
	objectType: ObjectTypeOf<T>,
	pairs: [T, T][],
): Change[] {
	return pairs.map(([before, after]) => ({
		action: 'update',
		objectType: resolveType(objectType, before),
		before,
		after,
	}))
}

/** Deletion entries for `rows`, in order. */
export function deleteChanges<T extends Snapshot>(
	objectType: ObjectTypeOf<T>,
	rows: T[],
): Change[] {
	return rows.map((row) => ({
		action: 'delete',
		objectType: resolveType(objectType, row),
		before: row,
		after: null,
	}))
}

/** Records the creation of `rows` with one INSERT (see `logChanges`). */
function logCreates<T extends Snapshot>(objectType: ObjectTypeOf<T>, rows: T[]): Promise<void> {
	return logChanges(createChanges(objectType, rows))
}

/** Records `[before, after]` updates with one INSERT (see `logChanges`). */
export function logUpdates<T extends Snapshot>(
	objectType: ObjectTypeOf<T>,
	pairs: [T, T][],
): Promise<void> {
	return logChanges(updateChanges(objectType, pairs))
}

/** Records the deletion of `rows` with one INSERT (see `logChanges`). */
export function logDeletes<T extends Snapshot>(
	objectType: ObjectTypeOf<T>,
	rows: T[],
): Promise<void> {
	return logChanges(deleteChanges(objectType, rows))
}

export interface ChangelogListParams extends ListParams, TenantFilterParams {
	action?: ChangeAction[]
	object_type?: ChangeObjectType[]
}

export async function listChangelog(
	params: ChangelogListParams,
): Promise<Result<Page<ObjectChangeJson>, Error>> {
	const where = and(
		searchCondition(params.search, [object_changes.object_repr, object_changes.username]),
		params.action ? inArray(object_changes.action, params.action) : undefined,
		params.object_type ? inArray(object_changes.object_type, params.object_type) : undefined,
		...tenantConditions(object_changes.tenant_id, params),
	)
	const page = await pageRows(
		object_changes,
		where,
		[desc(object_changes.created_at), desc(object_changes.id)],
		params,
	)
	return Result.ok(page as Page<ObjectChangeJson>)
}

export async function getObjectChange(id: number): Promise<Result<ObjectChangeJson, Error>> {
	return (await findById(object_changes, id, 'Change not found')) as Result<
		ObjectChangeJson,
		Error
	>
}

/** Drops changes past the retention window; returns the number removed. */
export async function pruneChangelog(now: number): Promise<number> {
	return (
		await getDb()
			.delete(object_changes)
			.where(lte(object_changes.created_at, now - CHANGELOG_RETENTION_S))
			.returning({ id: object_changes.id })
	).length
}
