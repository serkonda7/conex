import { AsyncLocalStorage } from 'node:async_hooks'
import { Result } from 'better-result'
import { and, desc, eq, lte } from 'drizzle-orm'
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
import { cableTenants, deviceTenant, rackTenant } from './owners'

/** Changes older than this are dropped by the periodic session sweep. */
export const CHANGELOG_RETENTION_S = 365 * 24 * 60 * 60

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

/** Display name of an object: its name, model or label, else `#id`. */
function reprOf(row: Snapshot): string {
	for (const key of ['name', 'model', 'label']) {
		const value = (row as Record<string, unknown>)[key]
		if (typeof value === 'string' && value !== '') {
			return value
		}
	}
	return `#${row.id}`
}

/**
 * Tenant whose scoped users may see the change: the tenant itself, the
 * row's `tenant_id`, or the parent's for tenant-less children. A cable
 * belongs to a tenant only when both ends do (the cable read rule).
 * Catalog data has none.
 */
async function tenantOf(objectType: ChangeObjectType, row: Snapshot): Promise<number | null> {
	const fields = row as Record<string, unknown>
	const ref = (key: string): number | null =>
		typeof fields[key] === 'number' ? (fields[key] as number) : null
	switch (objectType) {
		case 'tenant':
			return row.id
		case 'employee':
		case 'site_group':
		case 'site':
		case 'location':
		case 'rack':
		case 'device':
			return ref('tenant_id')
		case 'shelf': {
			const rack = ref('rack_id')
			return rack === null ? null : ((await rackTenant(rack)) ?? null)
		}
		case 'interface': {
			const device = ref('device_id')
			return device === null ? null : ((await deviceTenant(device)) ?? null)
		}
		case 'cable': {
			const a = ref('a_interface_id')
			const b = ref('b_interface_id')
			if (a === null || b === null) {
				return null
			}
			const [tenantA, tenantB] = await cableTenants({ a_interface_id: a, b_interface_id: b })
			return tenantA === tenantB ? tenantA : null
		}
		default:
			return null
	}
}

/**
 * Appends one change. Runs on the caller's `getDb()`, so inside
 * `withTransaction` it commits or rolls back with the change itself. A
 * failed write is logged but never fails the change.
 */
async function recordChange(
	action: ChangeAction,
	objectType: ChangeObjectType,
	before: Snapshot | null,
	after: Snapshot | null,
): Promise<void> {
	const subject = after ?? before
	if (!subject) {
		return
	}
	// A patch that changed nothing is not a change.
	if (before && after && JSON.stringify(before) === JSON.stringify(after)) {
		return
	}
	const actor = actorStore.getStore()
	try {
		const tenantId = await tenantOf(objectType, subject)
		await getDb()
			.insert(object_changes)
			.values({
				created_at: nowSeconds(),
				user_id: actor?.user_id ?? null,
				username: actor?.username ?? '',
				request_id: actor?.request_id ?? null,
				action,
				object_type: objectType,
				object_id: subject.id,
				object_repr: reprOf(subject),
				tenant_id: tenantId,
				prechange_data: before,
				postchange_data: after,
			})
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
		await recordChange('create', resolveType(objectType, result.value), null, result.value)
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
		await recordChange('update', resolveType(objectType, before), before, result.value)
	}
	return result
}

/** Records the deletion of `before`; returns it as the delete result. */
export async function logDelete<T extends Snapshot>(
	objectType: ObjectTypeOf<T>,
	before: T,
): Promise<Result<T, Error>> {
	await recordChange('delete', resolveType(objectType, before), before, null)
	return Result.ok(before)
}

export interface ChangelogListParams extends ListParams, TenantFilterParams {
	action?: ChangeAction
	object_type?: ChangeObjectType
}

export async function listChangelog(
	params: ChangelogListParams,
): Promise<Result<Page<ObjectChangeJson>, Error>> {
	const where = and(
		searchCondition(params.search, [object_changes.object_repr, object_changes.username]),
		params.action ? eq(object_changes.action, params.action) : undefined,
		params.object_type ? eq(object_changes.object_type, params.object_type) : undefined,
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
