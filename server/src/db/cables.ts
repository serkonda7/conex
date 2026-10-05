import { Result } from 'better-result'
import { and, asc, eq, inArray, or, type SQL, type SQLWrapper, sql } from 'drizzle-orm'
import type { PgColumn } from 'drizzle-orm/pg-core'
import type { CableCreate, CableUpdate } from 'shared/src/schemas'
import { cables, devices, interfaces } from '../schema'
import { logCreate, logDelete, logUpdate } from './changelog'
import { getDb } from './connection'
import { ConflictError, NotFoundError } from './errors'
import type { ListParams, Page } from './list'
import {
	exists,
	findById,
	findOne,
	insertedId,
	isPatchEmpty,
	pageRows,
	pickDefined,
	searchCondition,
	tryWrite,
} from './list'

export type CableRow = typeof cables.$inferSelect

/**
 * Both endpoint devices of a cable sit in `tenantId` (the cable read rule of
 * `authz.ts` as SQL), so no peer name from another tenant leaks.
 */
export function cableInTenant(tenantId: number): SQL {
	const endIn = (end: PgColumn): SQL =>
		sql`EXISTS (SELECT 1 FROM ${interfaces} AS scope_i JOIN ${devices} AS scope_d ON scope_d.id = scope_i.device_id WHERE scope_i.id = ${end} AND scope_d.tenant_id = ${tenantId})`
	return sql`(${endIn(cables.a_interface_id)} AND ${endIn(cables.b_interface_id)})`
}

/** Cable with either end on one of `ifaceIds` (a list or a subquery). */
function cableTouches(ifaceIds: number[] | SQLWrapper): SQL | undefined {
	return or(inArray(cables.a_interface_id, ifaceIds), inArray(cables.b_interface_id, ifaceIds))
}

// ---------------------------------------------------------------------------
// Cables
// ---------------------------------------------------------------------------

export interface CableListParams extends ListParams {
	status?: string
	interface?: number
	device?: number
	/**
	 * Tenant scope for scoped editors/viewers: restricts the list to cables
	 * whose both endpoint devices sit in the scope tenant (strict — shared
	 * endpoints excluded), so no peer name from another tenant leaks.
	 * `undefined` means unconstrained.
	 */
	scopeTenantId?: number
}

export function listCables(params: CableListParams): Promise<Page<CableRow>> {
	const where = and(
		searchCondition(params.search, [cables.label, cables.kind]),
		params.status ? eq(cables.status, params.status) : undefined,
		params.interface ? cableTouches([params.interface]) : undefined,
		params.device
			? cableTouches(
					getDb()
						.select({ id: interfaces.id })
						.from(interfaces)
						.where(eq(interfaces.device_id, params.device)),
				)
			: undefined,
		params.scopeTenantId !== undefined ? cableInTenant(params.scopeTenantId) : undefined,
	)
	return pageRows(cables, where, [asc(cables.id)], params)
}

export function getCable(id: number): Promise<Result<CableRow, Error>> {
	return findById(cables, id, 'Cable not found')
}

/**
 * Connects two free interfaces with a cable. Guards (all 409 unless an
 * endpoint is missing, which is 404):
 * - the two ends are distinct (same interface twice rejected);
 * - both interfaces exist;
 * - both interfaces are free (`connected=false`, no cable on either end).
 * The insert plus both `connected=true` flips run in one transaction.
 * Same-device links are allowed when the interfaces differ (v1).
 */
export async function connectCable(input: CableCreate): Promise<Result<CableRow, Error>> {
	if (input.a_interface_id === input.b_interface_id) {
		return Result.err(new ConflictError('Cannot connect an interface to itself'))
	}
	const ends: (typeof interfaces.$inferSelect)[] = []
	for (const [field, id] of [
		['a_interface_id', input.a_interface_id],
		['b_interface_id', input.b_interface_id],
	] as const) {
		const iface = await findOne(interfaces, eq(interfaces.id, id))
		if (!iface) {
			return Result.err(new NotFoundError(`Interface ${field} not found`))
		}
		ends.push(iface)
	}
	for (const iface of ends) {
		if (iface.connected !== 0 || (await exists(cables, cableTouches([iface.id])))) {
			return Result.err(new ConflictError(`Interface ${iface.name} is already connected`))
		}
	}
	const row: Omit<CableRow, 'id'> = {
		a_interface_id: input.a_interface_id,
		b_interface_id: input.b_interface_id,
		status: input.status ?? 'connected',
		kind: input.kind ?? null,
		label: input.label ?? null,
		description: input.description ?? null,
	}
	const id = await tryWrite(
		() =>
			getDb().transaction(async (tx) => {
				const cableId = insertedId(
					await tx.insert(cables).values(row).returning({ id: cables.id }),
				)
				await tx
					.update(interfaces)
					.set({ connected: 1 })
					.where(inArray(interfaces.id, [row.a_interface_id, row.b_interface_id]))
				return cableId
			}),
		() => new ConflictError('One of these interfaces is already connected'),
	)
	if (Result.isError(id)) {
		return id
	}
	return await logCreate('cable', await getCable(id.value))
}

export async function updateCable(
	id: number,
	input: CableUpdate,
): Promise<Result<CableRow, Error>> {
	const current = await getCable(id)
	if (Result.isError(current)) {
		return current
	}
	const patch = pickDefined(input, ['status', 'kind', 'label', 'description'])
	if (!isPatchEmpty(patch)) {
		const written = await tryWrite(
			() => getDb().update(cables).set(patch).where(eq(cables.id, id)),
			'A record with these values already exists',
		)
		if (Result.isError(written)) {
			return written
		}
	}
	return await logUpdate('cable', current.value, await getCable(id))
}

/**
 * Deletes a cable and frees both ends (`connected=false`). Missing peer
 * interface rows (e.g. after a forced cleanup) are tolerated: the flags that
 * can be cleared are cleared and the cable row is always removed.
 */
export async function deleteCable(id: number): Promise<Result<CableRow, Error>> {
	const current = await getCable(id)
	if (Result.isError(current)) {
		return current
	}
	const cable = current.value
	const deleted = await tryWrite(() =>
		getDb().transaction(async (tx) => {
			await tx.delete(cables).where(eq(cables.id, id))
			await tx
				.update(interfaces)
				.set({ connected: 0 })
				.where(inArray(interfaces.id, [cable.a_interface_id, cable.b_interface_id]))
		}),
	)
	if (Result.isError(deleted)) {
		return deleted
	}
	return await logDelete('cable', cable)
}

/** True when any cable touches an interface of the device (blocks device delete). */
export function deviceHasCables(deviceId: number): Promise<boolean> {
	return exists(
		cables,
		cableTouches(
			getDb()
				.select({ id: interfaces.id })
				.from(interfaces)
				.where(eq(interfaces.device_id, deviceId)),
		),
	)
}
