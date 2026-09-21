import { Result } from 'better-result'
import { and, count, eq, or, type SQL, sql } from 'drizzle-orm'
import type { CableCreate, CableUpdate, DeviceTraceResponse, TraceLink } from 'shared/src/schemas'
import { cables, devices, interfaces } from '../schema'
import { getDb } from './connection'
import type { InterfaceRow } from './devices'
import { ConflictError, DuplicateError, isUniqueViolation, NotFoundError } from './errors'
import type { ListParams, Page } from './tenancy'

export type CableRow = typeof cables.$inferSelect

function pageOf<T>(items: T[], total: number, params: ListParams): Page<T> {
	return { items, total, page: params.page, limit: params.limit }
}

function offsetOf(params: ListParams): number {
	return (params.page - 1) * params.limit
}

/** LIKE pattern with `%`, `_` and `\` escaped so the search stays literal. */
function searchPattern(raw: string): string {
	return `%${raw.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')}%`
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

export function listCables(params: CableListParams): Page<CableRow> {
	const db = getDb()
	const pattern = searchPattern(params.search)
	const conditions: SQL[] = []
	if (params.search) {
		conditions.push(
			sql`(${cables.label} LIKE ${pattern} ESCAPE '\\' OR ${cables.kind} LIKE ${pattern} ESCAPE '\\')`,
		)
	}
	if (params.status) {
		conditions.push(eq(cables.status, params.status))
	}
	if (params.interface) {
		const eitherEnd = or(
			eq(cables.a_interface_id, params.interface),
			eq(cables.b_interface_id, params.interface),
		)
		if (eitherEnd) {
			conditions.push(eitherEnd)
		}
	}
	if (params.device) {
		const deviceIfaces = db
			.select({ id: interfaces.id })
			.from(interfaces)
			.where(eq(interfaces.device_id, params.device))
			.all()
			.map((r) => r.id)
		if (deviceIfaces.length === 0) {
			return pageOf([], 0, params)
		}
		const ors: SQL[] = []
		for (const id of deviceIfaces) {
			ors.push(eq(cables.a_interface_id, id), eq(cables.b_interface_id, id))
		}
		const combined = or(...ors)
		if (combined) {
			conditions.push(combined)
		}
	}
	if (params.scopeTenantId !== undefined) {
		const scope = params.scopeTenantId
		conditions.push(
			sql`EXISTS (SELECT 1 FROM ${interfaces} AS scope_ia JOIN ${devices} AS scope_da ON scope_da.id = scope_ia.device_id WHERE scope_ia.id = ${cables.a_interface_id} AND scope_da.tenant_id = ${scope})`,
		)
		conditions.push(
			sql`EXISTS (SELECT 1 FROM ${interfaces} AS scope_ib JOIN ${devices} AS scope_db ON scope_db.id = scope_ib.device_id WHERE scope_ib.id = ${cables.b_interface_id} AND scope_db.tenant_id = ${scope})`,
		)
	}
	const where = conditions.length > 0 ? and(...conditions) : undefined
	const items = db
		.select()
		.from(cables)
		.where(where)
		.orderBy(sql`"cables"."rowid"`)
		.limit(params.limit)
		.offset(offsetOf(params))
		.all()
	const totalRow = db.select({ n: count() }).from(cables).where(where).get()
	return pageOf(items, totalRow?.n ?? 0, params)
}

export function getCable(id: number): Result<CableRow, Error> {
	const row = getDb().select().from(cables).where(eq(cables.id, id)).get()
	if (!row) {
		return Result.err(new NotFoundError('Cable not found'))
	}
	return Result.ok(row)
}

export function getCableForInterface(interfaceId: number): CableRow | undefined {
	return getDb()
		.select()
		.from(cables)
		.where(or(eq(cables.a_interface_id, interfaceId), eq(cables.b_interface_id, interfaceId)))
		.get()
}

function getInterfaceRow(id: number): InterfaceRow | undefined {
	return getDb().select().from(interfaces).where(eq(interfaces.id, id)).get()
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
export function connectCable(input: CableCreate): Result<CableRow, Error> {
	if (input.a_interface_id === input.b_interface_id) {
		return Result.err(new ConflictError('Cannot connect an interface to itself'))
	}
	const a = getInterfaceRow(input.a_interface_id)
	if (!a) {
		return Result.err(new NotFoundError('Interface a_interface_id not found'))
	}
	const b = getInterfaceRow(input.b_interface_id)
	if (!b) {
		return Result.err(new NotFoundError('Interface b_interface_id not found'))
	}
	if (a.connected !== 0 || getCableForInterface(a.id)) {
		return Result.err(new ConflictError(`Interface ${a.name} is already connected`))
	}
	if (b.connected !== 0 || getCableForInterface(b.id)) {
		return Result.err(new ConflictError(`Interface ${b.name} is already connected`))
	}
	const row: Omit<CableRow, 'id'> = {
		a_interface_id: input.a_interface_id,
		b_interface_id: input.b_interface_id,
		status: input.status ?? 'connected',
		kind: input.kind ?? null,
		label: input.label ?? null,
		description: input.description ?? null,
	}
	let cableId: number | undefined
	try {
		getDb().transaction((tx) => {
			const inserted = tx.insert(cables).values(row).returning({ id: cables.id }).get()
			if (!inserted) {
				throw new Error('Cable insert did not return an id')
			}
			cableId = inserted.id
			tx.update(interfaces).set({ connected: 1 }).where(eq(interfaces.id, a.id)).run()
			tx.update(interfaces).set({ connected: 1 }).where(eq(interfaces.id, b.id)).run()
		})
	} catch (err) {
		if (isUniqueViolation(err)) {
			return Result.err(new ConflictError('One of these interfaces is already connected'))
		}
		return Result.err(err instanceof Error ? err : new Error(String(err)))
	}
	if (cableId === undefined) {
		return Result.err(new Error('Cable insert did not return an id'))
	}
	return getCable(cableId)
}

export function updateCable(id: number, input: CableUpdate): Result<CableRow, Error> {
	const current = getCable(id)
	if (Result.isError(current)) {
		return current
	}
	const patch: Partial<CableRow> = {}
	if (input.status !== undefined) {
		patch.status = input.status
	}
	if (input.kind !== undefined) {
		patch.kind = input.kind
	}
	if (input.label !== undefined) {
		patch.label = input.label
	}
	if (input.description !== undefined) {
		patch.description = input.description
	}
	if (Object.keys(patch).length > 0) {
		try {
			getDb().update(cables).set(patch).where(eq(cables.id, id)).run()
		} catch (err) {
			if (isUniqueViolation(err)) {
				return Result.err(new DuplicateError('A record with these values already exists'))
			}
			return Result.err(err instanceof Error ? err : new Error(String(err)))
		}
	}
	return getCable(id)
}

/**
 * Deletes a cable and frees both ends (`connected=false`). Missing peer
 * interface rows (e.g. after a forced cleanup) are tolerated: the flags that
 * can be cleared are cleared and the cable row is always removed.
 */
export function deleteCable(id: number): Result<CableRow, Error> {
	const current = getCable(id)
	if (Result.isError(current)) {
		return current
	}
	const cable = current.value
	getDb().transaction((tx) => {
		tx.delete(cables).where(eq(cables.id, id)).run()
		tx.update(interfaces)
			.set({ connected: 0 })
			.where(eq(interfaces.id, cable.a_interface_id))
			.run()
		tx.update(interfaces)
			.set({ connected: 0 })
			.where(eq(interfaces.id, cable.b_interface_id))
			.run()
	})
	return Result.ok(cable)
}

/** True when any cable touches an interface of the device (blocks device delete). */
export function deviceHasCables(deviceId: number): boolean {
	const db = getDb()
	const ifaceIds = db
		.select({ id: interfaces.id })
		.from(interfaces)
		.where(eq(interfaces.device_id, deviceId))
		.all()
		.map((r) => r.id)
	for (const id of ifaceIds) {
		if (getCableForInterface(id)) {
			return true
		}
	}
	return false
}

/**
 * Per-device trace: every local interface carrying a cable resolves to its
 * peer as `dev:port <-> dev:port`. Unconnected local ports produce no link.
 */
export function getDeviceTrace(deviceId: number): Result<DeviceTraceResponse, Error> {
	const db = getDb()
	const device = db.select().from(devices).where(eq(devices.id, deviceId)).get()
	if (!device) {
		return Result.err(new NotFoundError('Device not found'))
	}
	const local = db.select().from(interfaces).where(eq(interfaces.device_id, deviceId)).all()
	const links: TraceLink[] = []
	for (const iface of local) {
		const cable = getCableForInterface(iface.id)
		if (!cable) {
			continue
		}
		const peerId =
			cable.a_interface_id === iface.id ? cable.b_interface_id : cable.a_interface_id
		const peer = getInterfaceRow(peerId)
		if (!peer) {
			continue
		}
		const peerDevice = db.select().from(devices).where(eq(devices.id, peer.device_id)).get()
		if (!peerDevice) {
			continue
		}
		links.push({
			cable_id: cable.id,
			cable_label: cable.label,
			cable_status: cable.status,
			local_interface: { id: iface.id, name: iface.name, kind: iface.kind },
			peer_device: { id: peerDevice.id, name: peerDevice.name },
			peer_interface: { id: peer.id, name: peer.name, kind: peer.kind },
		})
	}
	return Result.ok({ device_id: deviceId, links })
}
