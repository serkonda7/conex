import { Result } from 'better-result'
import { and, asc, count, eq, inArray, or, type SQL, sql } from 'drizzle-orm'
import type { CableCreate, CableUpdate, DeviceTraceResponse, TraceLink } from 'shared/src/schemas'
import { cables, devices, interfaces } from '../schema'
import { getDb } from './connection'
import type { InterfaceRow } from './devices'
import { ConflictError, DuplicateError, isUniqueViolation, NotFoundError } from './errors'
import type { ListParams, Page } from './list'
import { errOf, isPatchEmpty, offsetOf, pageOf, searchPattern } from './list'
import { getDevicePaths } from './topology'

export type CableRow = typeof cables.$inferSelect

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

export async function listCables(params: CableListParams): Promise<Page<CableRow>> {
	const db = getDb()
	const pattern = searchPattern(params.search)
	const conditions: SQL[] = []
	if (params.search) {
		conditions.push(
			sql`(${cables.label} ILIKE ${pattern} ESCAPE '\\' OR ${cables.kind} ILIKE ${pattern} ESCAPE '\\')`,
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
		const deviceIfaces = (
			await db
				.select({ id: interfaces.id })
				.from(interfaces)
				.where(eq(interfaces.device_id, params.device))
		).map((r) => r.id)
		if (deviceIfaces.length === 0) {
			return pageOf([], 0, params)
		}
		const eitherEnd = or(
			inArray(cables.a_interface_id, deviceIfaces),
			inArray(cables.b_interface_id, deviceIfaces),
		)
		if (eitherEnd) {
			conditions.push(eitherEnd)
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
	const items = await db
		.select()
		.from(cables)
		.where(where)
		.orderBy(asc(cables.id))
		.limit(params.limit)
		.offset(offsetOf(params))
	const totalRow = (await db.select({ n: count() }).from(cables).where(where).limit(1))[0]
	return pageOf(items, totalRow?.n ?? 0, params)
}

export async function getCable(id: number): Promise<Result<CableRow, Error>> {
	const row = (await getDb().select().from(cables).where(eq(cables.id, id)).limit(1))[0]
	if (!row) {
		return Result.err(new NotFoundError('Cable not found'))
	}
	return Result.ok(row)
}

export async function getCableForInterface(interfaceId: number): Promise<CableRow | undefined> {
	return (
		await getDb()
			.select()
			.from(cables)
			.where(
				or(eq(cables.a_interface_id, interfaceId), eq(cables.b_interface_id, interfaceId)),
			)
			.limit(1)
	)[0]
}

async function getInterfaceRow(id: number): Promise<InterfaceRow | undefined> {
	return (await getDb().select().from(interfaces).where(eq(interfaces.id, id)).limit(1))[0]
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
	const a = await getInterfaceRow(input.a_interface_id)
	if (!a) {
		return Result.err(new NotFoundError('Interface a_interface_id not found'))
	}
	const b = await getInterfaceRow(input.b_interface_id)
	if (!b) {
		return Result.err(new NotFoundError('Interface b_interface_id not found'))
	}
	if (a.connected !== 0 || (await getCableForInterface(a.id))) {
		return Result.err(new ConflictError(`Interface ${a.name} is already connected`))
	}
	if (b.connected !== 0 || (await getCableForInterface(b.id))) {
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
		await getDb().transaction(async (tx) => {
			const inserted = (await tx.insert(cables).values(row).returning({ id: cables.id }))[0]
			if (!inserted) {
				throw new Error('Cable insert did not return an id')
			}
			cableId = inserted.id
			await tx.update(interfaces).set({ connected: 1 }).where(eq(interfaces.id, a.id))
			await tx.update(interfaces).set({ connected: 1 }).where(eq(interfaces.id, b.id))
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
	return await getCable(cableId)
}

export async function updateCable(
	id: number,
	input: CableUpdate,
): Promise<Result<CableRow, Error>> {
	const current = await getCable(id)
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
	if (!isPatchEmpty(patch)) {
		try {
			await getDb().update(cables).set(patch).where(eq(cables.id, id))
		} catch (err) {
			if (isUniqueViolation(err)) {
				return Result.err(new DuplicateError('A record with these values already exists'))
			}
			return Result.err(err instanceof Error ? err : new Error(String(err)))
		}
	}
	return await getCable(id)
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
	try {
		await getDb().transaction(async (tx) => {
			await tx.delete(cables).where(eq(cables.id, id))
			await tx
				.update(interfaces)
				.set({ connected: 0 })
				.where(eq(interfaces.id, cable.a_interface_id))
			await tx
				.update(interfaces)
				.set({ connected: 0 })
				.where(eq(interfaces.id, cable.b_interface_id))
		})
	} catch (e) {
		return Result.err(errOf(e))
	}
	return Result.ok(cable)
}

/** True when any cable touches an interface of the device (blocks device delete). */
export async function deviceHasCables(deviceId: number): Promise<boolean> {
	const row = (
		await getDb()
			.select({ id: cables.id })
			.from(cables)
			.where(
				sql`EXISTS (SELECT 1 FROM ${interfaces} WHERE ${interfaces.device_id} = ${deviceId} AND (${interfaces.id} = ${cables.a_interface_id} OR ${interfaces.id} = ${cables.b_interface_id}))`,
			)
			.limit(1)
	)[0]
	return row !== undefined
}

/**
 * Per-device trace: every local interface carrying a cable resolves to its
 * peer as `dev:port <-> dev:port`. Unconnected local ports produce no link.
 * `paths` holds the depth-limited multi-hop shortest paths (BFS over the
 * cable graph) so callers can render full cable traces, not just direct
 * peers. Scoped callers only traverse cables with both ends in their tenant.
 */
export async function getDeviceTrace(
	deviceId: number,
	depth = 4,
	scopeTenantId?: number,
): Promise<Result<DeviceTraceResponse, Error>> {
	const db = getDb()
	const device = (await db.select().from(devices).where(eq(devices.id, deviceId)).limit(1))[0]
	if (!device) {
		return Result.err(new NotFoundError('Device not found'))
	}
	const local = await db.select().from(interfaces).where(eq(interfaces.device_id, deviceId))
	const localIds = local.map((i) => i.id)
	const cablesByIface = new Map<number, typeof cables.$inferSelect>()
	if (localIds.length > 0) {
		for (const cable of await db
			.select()
			.from(cables)
			.where(
				or(
					inArray(cables.a_interface_id, localIds),
					inArray(cables.b_interface_id, localIds),
				),
			)) {
			cablesByIface.set(cable.a_interface_id, cable)
			cablesByIface.set(cable.b_interface_id, cable)
		}
	}
	const peerIds = [...cablesByIface.values()].flatMap((c) => [c.a_interface_id, c.b_interface_id])
	const ifacesById = new Map<number, InterfaceRow>()
	if (peerIds.length > 0) {
		for (const row of await db
			.select()
			.from(interfaces)
			.where(inArray(interfaces.id, [...new Set(peerIds)]))) {
			ifacesById.set(row.id, row)
		}
	}
	const peerDeviceIds = [...new Set([...ifacesById.values()].map((r) => r.device_id))]
	const devicesById = new Map<number, typeof devices.$inferSelect>()
	if (peerDeviceIds.length > 0) {
		for (const row of await db
			.select()
			.from(devices)
			.where(inArray(devices.id, peerDeviceIds))) {
			devicesById.set(row.id, row)
		}
	}
	const links: TraceLink[] = []
	for (const iface of local) {
		const cable = cablesByIface.get(iface.id)
		if (!cable) {
			continue
		}
		const peerId =
			cable.a_interface_id === iface.id ? cable.b_interface_id : cable.a_interface_id
		const peer = ifacesById.get(peerId)
		if (!peer) {
			continue
		}
		const peerDevice = devicesById.get(peer.device_id)
		if (!peerDevice) {
			continue
		}
		// Scoped callers see only cables with both ends in their tenant, so
		// no peer name from another tenant leaks through direct links.
		if (scopeTenantId !== undefined) {
			if (device.tenant_id !== scopeTenantId || peerDevice.tenant_id !== scopeTenantId) {
				continue
			}
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
	const boundedDepth = Math.min(Math.max(Math.floor(depth), 1), 10)
	const pathsResult = await getDevicePaths(deviceId, boundedDepth, scopeTenantId)
	if (Result.isError(pathsResult)) {
		// The device exists (checked above); a scope miss here just means no
		// visible paths, so fall back to an empty set instead of a 404.
		return Result.ok({ device_id: deviceId, links, paths: [] })
	}
	return Result.ok({ device_id: deviceId, links, paths: pathsResult.value })
}
