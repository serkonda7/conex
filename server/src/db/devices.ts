import { Result } from 'better-result'
import { and, asc, count, desc, eq, type SQL, sql } from 'drizzle-orm'
import type {
	DeviceCreate,
	DeviceMove,
	DeviceUpdate,
	InterfaceCreate,
	InterfaceUpdate,
} from 'shared/src/schemas'
import {
	device_type_interfaces,
	device_types,
	devices,
	interfaces,
	locations,
	rack_shelves,
	racks,
	sites,
} from '../schema'
import { checkBounds, checkOverlap } from '../services/occupancy'
import { expandStubs } from '../services/templates'
import { deviceHasCables } from './cables'
import { getDb } from './connection'
import { ConflictError, DuplicateError, isUniqueViolation, NotFoundError } from './errors'
import type { ListParams, Page } from './list'
import { checkTenantExists, errOf, isPatchEmpty, offsetOf, pageOf, searchPattern } from './list'
import { deviceSpansOf, rackHeightOf } from './racks'

export type DeviceRow = typeof devices.$inferSelect
export type InterfaceRow = typeof interfaces.$inferSelect

/** Wire shape of an interface: `connected` reads as a boolean (P5 flips it). */
export interface InterfaceJson extends Omit<InterfaceRow, 'connected'> {
	connected: boolean
}

function toInterfaceJson(row: InterfaceRow): InterfaceJson {
	return { ...row, connected: row.connected !== 0 }
}

// ---------------------------------------------------------------------------
// Mount validation
// ---------------------------------------------------------------------------

export interface MountInput {
	rack_id: number | null
	position_u: number | null
	shelf_id: number | null
	face: 'front' | 'rear' | null
	is_full_depth: boolean
}

/**
 * Enforces the mount XOR: position_u XOR shelf_id, never both. Racked
 * devices carry exactly one; unracked devices carry neither. Position mounts
 * consume the template `u_height` in U (bounds + shelf/device overlap
 * checked); shelf mounts consume 0 U but the shelf must sit in the same
 * rack. `excludeDeviceId` skips the device being moved so a no-op move is
 * not self-conflicting.
 */
function checkMount(
	deviceName: string,
	mount: MountInput,
	uHeight: number,
	excludeDeviceId?: number,
): Result<undefined, Error> {
	const db = getDb()
	if (mount.position_u !== null && mount.shelf_id !== null) {
		return Result.err(
			new ConflictError('Device mount is either a rack position or a shelf, never both'),
		)
	}
	if (mount.rack_id === null) {
		if (mount.position_u !== null || mount.shelf_id !== null) {
			return Result.err(
				new ConflictError('Unracked device cannot have a rack position or a shelf'),
			)
		}
		return Result.ok(undefined)
	}
	const rack = db.select().from(racks).where(eq(racks.id, mount.rack_id)).get()
	if (!rack) {
		return Result.err(new NotFoundError('Rack not found'))
	}
	if (mount.position_u === null && mount.shelf_id === null) {
		return Result.err(
			new ConflictError('Rack-mounted device needs either position_u or shelf_id'),
		)
	}
	if (mount.shelf_id !== null) {
		const shelf = db
			.select()
			.from(rack_shelves)
			.where(eq(rack_shelves.id, mount.shelf_id))
			.get()
		if (!shelf || shelf.rack_id !== mount.rack_id) {
			return Result.err(new NotFoundError('Shelf not found in this rack'))
		}
		// Shelf-sitters consume 0 U regardless of template height, so no
		// bounds/overlap check applies here.
		return Result.ok(undefined)
	}
	// Position mount from here on (`position_u` is non-null).
	const positionU = mount.position_u as number
	if (uHeight < 1) {
		return Result.err(
			new ConflictError(
				'This device type consumes 0 U; mount it on a shelf instead of a rack position',
			),
		)
	}
	const candidate = {
		id: excludeDeviceId ?? 0,
		name: deviceName,
		position_u: positionU,
		height_u: uHeight,
		face: mount.face,
		is_full_depth: mount.is_full_depth,
	}
	const bounds = checkBounds(candidate, rackHeightOf(rack), `Device "${deviceName}"`)
	if (Result.isError(bounds)) {
		return Result.err(bounds.error)
	}
	const shelfSpans = db
		.select()
		.from(rack_shelves)
		.where(eq(rack_shelves.rack_id, mount.rack_id))
		.all()
		.map((s) => ({ id: s.id, name: s.name, position_u: s.position_u, height_u: s.height_u }))
	const overlap = checkOverlap(
		candidate,
		[...shelfSpans, ...deviceSpansOf(mount.rack_id)],
		`Device "${deviceName}"`,
		excludeDeviceId,
	)
	if (Result.isError(overlap)) {
		return Result.err(overlap.error)
	}
	return Result.ok(undefined)
}

function checkSite(siteId: number | null | undefined): Result<undefined, Error> {
	if (siteId === null || siteId === undefined) {
		return Result.ok(undefined)
	}
	if (!getDb().select().from(sites).where(eq(sites.id, siteId)).get()) {
		return Result.err(new NotFoundError('Site not found'))
	}
	return Result.ok(undefined)
}

/** Location must exist; when a site is also given it must belong to that site. */
function checkLocation(
	locationId: number | null | undefined,
	siteId: number | null | undefined,
): Result<undefined, Error> {
	if (locationId === null || locationId === undefined) {
		return Result.ok(undefined)
	}
	const location = getDb().select().from(locations).where(eq(locations.id, locationId)).get()
	if (!location) {
		return Result.err(new NotFoundError('Location not found'))
	}
	if (siteId !== null && siteId !== undefined && location.site_id !== siteId) {
		return Result.err(new NotFoundError('Location not found in this site'))
	}
	return Result.ok(undefined)
}

/** The rack location is authoritative for a rack-mounted device. */
function rackLocationId(rackId: number): Result<number | null, Error> {
	const rack = getDb()
		.select({ location_id: racks.location_id })
		.from(racks)
		.where(eq(racks.id, rackId))
		.get()
	if (!rack) {
		return Result.err(new NotFoundError('Rack not found'))
	}
	return Result.ok(rack.location_id)
}

function checkAssetTag(
	assetTag: string | null | undefined,
	excludeDeviceId?: number,
): Result<undefined, Error> {
	if (assetTag === null || assetTag === undefined) {
		return Result.ok(undefined)
	}
	const clash = getDb().select().from(devices).where(eq(devices.asset_tag, assetTag)).get()
	if (clash && clash.id !== excludeDeviceId) {
		return Result.err(new DuplicateError('Asset tag is already in use'))
	}
	return Result.ok(undefined)
}

// ---------------------------------------------------------------------------
// Devices
// ---------------------------------------------------------------------------

export interface DeviceListParams extends ListParams {
	site?: number
	rack?: number
	tenant?: number
	status?: string
	sort: 'name' | 'status'
	order: 'asc' | 'desc'
	/** Tenant scope (own tenant only, strict); `undefined` = unconstrained. */
	scopeTenantId?: number
}

export function listDevices(params: DeviceListParams): Page<DeviceRow> {
	const db = getDb()
	const pattern = searchPattern(params.search)
	const conditions: SQL[] = []
	if (params.search) {
		conditions.push(
			sql`(${devices.name} LIKE ${pattern} ESCAPE '\\' OR ${devices.asset_tag} LIKE ${pattern} ESCAPE '\\' OR ${devices.serial} LIKE ${pattern} ESCAPE '\\')`,
		)
	}
	if (params.site) {
		conditions.push(eq(devices.site_id, params.site))
	}
	if (params.rack) {
		conditions.push(eq(devices.rack_id, params.rack))
	}
	if (params.tenant) {
		conditions.push(eq(devices.tenant_id, params.tenant))
	}
	if (params.scopeTenantId !== undefined) {
		conditions.push(eq(devices.tenant_id, params.scopeTenantId))
	}
	if (params.status) {
		conditions.push(eq(devices.status, params.status))
	}
	const where = conditions.length > 0 ? and(...conditions) : undefined
	const orderColumn = params.sort === 'status' ? devices.status : devices.name
	const items = db
		.select()
		.from(devices)
		.where(where)
		.orderBy(params.order === 'desc' ? desc(orderColumn) : asc(orderColumn))
		.limit(params.limit)
		.offset(offsetOf(params))
		.all()
	const totalRow = db.select({ n: count() }).from(devices).where(where).get()
	return pageOf(items, totalRow?.n ?? 0, params)
}

export function getDevice(id: number): Result<DeviceRow, Error> {
	const row = getDb().select().from(devices).where(eq(devices.id, id)).get()
	if (!row) {
		return Result.err(new NotFoundError('Device not found'))
	}
	return Result.ok(row)
}

function mountOf(input: {
	rack_id?: number | null
	position_u?: number | null
	shelf_id?: number | null
	face?: 'front' | 'rear' | null
	is_full_depth?: boolean
}): MountInput {
	return {
		rack_id: input.rack_id ?? null,
		position_u: input.position_u ?? null,
		shelf_id: input.shelf_id ?? null,
		face: input.face ?? null,
		is_full_depth: input.is_full_depth ?? true,
	}
}

export function createDevice(input: DeviceCreate): Result<DeviceRow, Error> {
	const db = getDb()
	const template = db
		.select()
		.from(device_types)
		.where(eq(device_types.id, input.device_type_id))
		.get()
	if (!template) {
		return Result.err(new NotFoundError('Device type not found'))
	}
	const createMount = mountOf(input)
	createMount.is_full_depth = template.is_full_depth !== 0
	let deviceLocationId = input.location_id ?? null
	if (createMount.rack_id !== null) {
		const rackLocation = rackLocationId(createMount.rack_id)
		if (Result.isError(rackLocation)) {
			return Result.err(rackLocation.error)
		}
		deviceLocationId = rackLocation.value
	}
	for (const guard of [
		checkSite(input.site_id),
		checkLocation(deviceLocationId, input.site_id),
		checkTenantExists(input.tenant_id),
		checkAssetTag(input.asset_tag),
		checkMount(input.name, createMount, template.u_height),
	]) {
		if (Result.isError(guard)) {
			return Result.err(guard.error)
		}
	}
	// Stub rows are loaded before the transaction so a duplicate expansion
	// (e.g. from a concurrent stub edit) fails before anything is inserted.
	const stubs = db
		.select()
		.from(device_type_interfaces)
		.where(eq(device_type_interfaces.device_type_id, input.device_type_id))
		.all()
	const expanded = expandStubs(
		stubs.map((s) => ({
			prefix: s.prefix,
			count: s.count,
			kind: s.kind,
			label: s.label,
			description: s.description,
		})),
	)
	if (Result.isError(expanded)) {
		return Result.err(new ConflictError(expanded.error.message))
	}
	const values: Omit<DeviceRow, 'id'> = {
		device_type_id: input.device_type_id,
		site_id: input.site_id ?? null,
		location_id: deviceLocationId,
		rack_id: input.rack_id ?? null,
		face: input.face ?? null,
		position_u: input.position_u ?? null,
		shelf_id: input.shelf_id ?? null,
		status: input.status ?? 'active',
		name: input.name,
		serial: input.serial ?? null,
		asset_tag: input.asset_tag ?? null,
		tenant_id: input.tenant_id ?? null,
		description: input.description ?? null,
	}
	let deviceId: number | undefined
	try {
		db.transaction((tx) => {
			const inserted = tx.insert(devices).values(values).returning({ id: devices.id }).get()
			if (!inserted) {
				throw new Error('Device insert did not return an id')
			}
			deviceId = inserted.id
			for (const iface of expanded.value) {
				tx.insert(interfaces)
					.values({
						device_id: inserted.id,
						name: iface.name,
						kind: iface.kind,
						connected: 0,
						description: iface.description ?? iface.label,
					})
					.run()
			}
		})
	} catch (err) {
		if (isUniqueViolation(err)) {
			return Result.err(new DuplicateError('Asset tag is already in use'))
		}
		return Result.err(err instanceof Error ? err : new Error(String(err)))
	}
	if (deviceId === undefined) {
		return Result.err(new Error('Device insert did not return an id'))
	}
	return getDevice(deviceId)
}

export function updateDevice(id: number, input: DeviceUpdate): Result<DeviceRow, Error> {
	const current = getDevice(id)
	if (Result.isError(current)) {
		return current
	}
	const node = current.value
	const template = getDb()
		.select()
		.from(device_types)
		.where(eq(device_types.id, node.device_type_id))
		.get()
	if (!template) {
		return Result.err(new NotFoundError('Device type not found'))
	}
	const effectiveSite = input.site_id !== undefined ? input.site_id : node.site_id
	const effectiveRackId = input.rack_id !== undefined ? input.rack_id : node.rack_id
	const mountChanged =
		input.rack_id !== undefined ||
		input.position_u !== undefined ||
		input.shelf_id !== undefined
	let deviceLocationId = input.location_id !== undefined ? input.location_id : node.location_id
	if (mountChanged && effectiveRackId !== null && effectiveRackId !== undefined) {
		const rackLocation = rackLocationId(effectiveRackId)
		if (Result.isError(rackLocation)) {
			return Result.err(rackLocation.error)
		}
		deviceLocationId = rackLocation.value
	}
	for (const guard of [
		checkSite(input.site_id),
		checkLocation(
			deviceLocationId,
			input.site_id !== undefined ? input.site_id : effectiveSite,
		),
		checkTenantExists(input.tenant_id),
		checkAssetTag(input.asset_tag, id),
	]) {
		if (Result.isError(guard)) {
			return Result.err(guard.error)
		}
	}
	if (mountChanged) {
		const mount: MountInput = {
			rack_id: input.rack_id !== undefined ? input.rack_id : node.rack_id,
			position_u: input.position_u !== undefined ? input.position_u : node.position_u,
			shelf_id: input.shelf_id !== undefined ? input.shelf_id : node.shelf_id,
			face:
				input.face !== undefined
					? input.face
					: node.face === 'front' || node.face === 'rear'
						? node.face
						: null,
			is_full_depth: template.is_full_depth !== 0,
		}
		const mountCheck = checkMount(input.name ?? node.name, mount, template.u_height, id)
		if (Result.isError(mountCheck)) {
			return Result.err(mountCheck.error)
		}
	}
	const patch: Partial<DeviceRow> = {}
	if (input.name !== undefined) {
		patch.name = input.name
	}
	if (input.status !== undefined) {
		patch.status = input.status
	}
	if (input.site_id !== undefined) {
		patch.site_id = input.site_id
	}
	if (input.location_id !== undefined || (mountChanged && effectiveRackId !== null)) {
		patch.location_id = deviceLocationId
	}
	if (input.rack_id !== undefined) {
		patch.rack_id = input.rack_id
	}
	if (input.face !== undefined) {
		patch.face = input.face
	}
	if (input.position_u !== undefined) {
		patch.position_u = input.position_u
	}
	if (input.shelf_id !== undefined) {
		patch.shelf_id = input.shelf_id
	}
	if (input.serial !== undefined) {
		patch.serial = input.serial
	}
	if (input.asset_tag !== undefined) {
		patch.asset_tag = input.asset_tag
	}
	if (input.tenant_id !== undefined) {
		patch.tenant_id = input.tenant_id
	}
	if (input.description !== undefined) {
		patch.description = input.description
	}
	if (!isPatchEmpty(patch)) {
		try {
			getDb().update(devices).set(patch).where(eq(devices.id, id)).run()
		} catch (err) {
			if (isUniqueViolation(err)) {
				return Result.err(new DuplicateError('Asset tag is already in use'))
			}
			return Result.err(err instanceof Error ? err : new Error(String(err)))
		}
	}
	return getDevice(id)
}

/**
 * Explicit remount: `undefined` keeps the current mount value, `null` clears
 * it. The effective mount re-validates U/shelf exactly like creation.
 */
export function moveDevice(id: number, input: DeviceMove): Result<DeviceRow, Error> {
	const current = getDevice(id)
	if (Result.isError(current)) {
		return current
	}
	const node = current.value
	const template = getDb()
		.select()
		.from(device_types)
		.where(eq(device_types.id, node.device_type_id))
		.get()
	if (!template) {
		return Result.err(new NotFoundError('Device type not found'))
	}
	const mount: MountInput = {
		rack_id: input.rack_id !== undefined ? input.rack_id : node.rack_id,
		position_u: input.position_u !== undefined ? input.position_u : node.position_u,
		shelf_id: input.shelf_id !== undefined ? input.shelf_id : node.shelf_id,
		face: node.face === 'front' || node.face === 'rear' ? node.face : null,
		is_full_depth: template.is_full_depth !== 0,
	}
	const mountCheck = checkMount(node.name, mount, template.u_height, id)
	if (Result.isError(mountCheck)) {
		return Result.err(mountCheck.error)
	}
	const patch: Partial<DeviceRow> = {
		rack_id: mount.rack_id,
		position_u: mount.position_u,
		shelf_id: mount.shelf_id,
	}
	if (mount.rack_id !== null) {
		const rackLocation = rackLocationId(mount.rack_id)
		if (Result.isError(rackLocation)) {
			return Result.err(rackLocation.error)
		}
		patch.location_id = rackLocation.value
	}
	getDb().update(devices).set(patch).where(eq(devices.id, id)).run()
	return getDevice(id)
}

export function deleteDevice(id: number): Result<DeviceRow, Error> {
	const current = getDevice(id)
	if (Result.isError(current)) {
		return current
	}
	// Cabled ports stay consistent: remove cables first so no peer is left
	// pointing at a deleted interface (FK + connected flag both matter).
	if (deviceHasCables(id)) {
		return Result.err(
			new ConflictError('Device still has connected cables; disconnect them first'),
		)
	}
	try {
		getDb().transaction((tx) => {
			tx.delete(interfaces).where(eq(interfaces.device_id, id)).run()
			tx.delete(devices).where(eq(devices.id, id)).run()
		})
	} catch (e) {
		return Result.err(errOf(e))
	}
	return Result.ok(current.value)
}

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export function listInterfaces(deviceId: number): Result<InterfaceJson[], Error> {
	const device = getDevice(deviceId)
	if (Result.isError(device)) {
		return Result.err(device.error)
	}
	const rows = getDb()
		.select()
		.from(interfaces)
		.where(eq(interfaces.device_id, deviceId))
		// Creation order, not name order: stub expansion inserts eth1..eth24
		// sequentially, so the list reads back in natural port order
		// (lexicographic name order would put eth10 before eth2).
		.orderBy(sql`"interfaces"."rowid"`)
		.all()
	return Result.ok(rows.map(toInterfaceJson))
}

export interface InterfaceListParams extends ListParams {
	device?: number
	connected?: boolean
	/**
	 * Tenant scope for scoped editors/viewers: restricts the list to
	 * interfaces whose device sits in the scope tenant (strict — shared
	 * `NULL` rows are excluded). `undefined` means unconstrained.
	 */
	scopeTenantId?: number
}

/** One interface row for the global list view, with its device's name. */
export interface InterfaceListItem extends InterfaceJson {
	device_name: string
}

/**
 * Global interface list across devices. Ordered by device name, then port
 * creation order (stub expansion inserts eth1..ethN sequentially, so each
 * device's ports read back in natural order — lexicographic name order
 * would put eth10 before eth2).
 */
export function listAllInterfaces(params: InterfaceListParams): Page<InterfaceListItem> {
	const db = getDb()
	const pattern = searchPattern(params.search)
	const conditions: SQL[] = []
	if (params.search) {
		conditions.push(
			sql`(${interfaces.name} LIKE ${pattern} ESCAPE '\\' OR ${interfaces.kind} LIKE ${pattern} ESCAPE '\\' OR ${devices.name} LIKE ${pattern} ESCAPE '\\')`,
		)
	}
	if (params.device !== undefined) {
		conditions.push(eq(interfaces.device_id, params.device))
	}
	if (params.connected !== undefined) {
		conditions.push(eq(interfaces.connected, params.connected ? 1 : 0))
	}
	if (params.scopeTenantId !== undefined) {
		conditions.push(eq(devices.tenant_id, params.scopeTenantId))
	}
	const where = conditions.length > 0 ? and(...conditions) : undefined
	const rows = db
		.select({ iface: interfaces, device_name: devices.name })
		.from(interfaces)
		.innerJoin(devices, eq(interfaces.device_id, devices.id))
		.where(where)
		.orderBy(sql`${devices.name}`, sql`"interfaces"."rowid"`)
		.limit(params.limit)
		.offset(offsetOf(params))
		.all()
	const totalRow = db
		.select({ n: count() })
		.from(interfaces)
		.innerJoin(devices, eq(interfaces.device_id, devices.id))
		.where(where)
		.get()
	return pageOf(
		rows.map((r) => ({ ...toInterfaceJson(r.iface), device_name: r.device_name })),
		totalRow?.n ?? 0,
		params,
	)
}

export function getInterface(deviceId: number, ifaceId: number): Result<InterfaceJson, Error> {
	const row = getDb().select().from(interfaces).where(eq(interfaces.id, ifaceId)).get()
	if (!row || row.device_id !== deviceId) {
		return Result.err(new NotFoundError('Interface not found on this device'))
	}
	return Result.ok(toInterfaceJson(row))
}

export function addInterface(
	deviceId: number,
	input: InterfaceCreate,
): Result<InterfaceJson, Error> {
	const device = getDevice(deviceId)
	if (Result.isError(device)) {
		return Result.err(device.error)
	}
	const clash = getDb()
		.select()
		.from(interfaces)
		.where(and(eq(interfaces.device_id, deviceId), eq(interfaces.name, input.name)))
		.get()
	if (clash) {
		return Result.err(new DuplicateError('This device already has an interface with this name'))
	}
	const row: Omit<InterfaceRow, 'id'> = {
		device_id: deviceId,
		name: input.name,
		kind: input.kind ?? 'ethernet',
		connected: 0,
		description: input.description ?? null,
	}
	try {
		const inserted = getDb()
			.insert(interfaces)
			.values(row)
			.returning({ id: interfaces.id })
			.get()
		if (!inserted) {
			return Result.err(new Error('Interface insert did not return an id'))
		}
		return getInterface(deviceId, inserted.id)
	} catch (err) {
		if (isUniqueViolation(err)) {
			return Result.err(
				new DuplicateError('This device already has an interface with this name'),
			)
		}
		return Result.err(err instanceof Error ? err : new Error(String(err)))
	}
}

export function updateInterface(
	deviceId: number,
	ifaceId: number,
	input: InterfaceUpdate,
): Result<InterfaceJson, Error> {
	const current = getInterface(deviceId, ifaceId)
	if (Result.isError(current)) {
		return current
	}
	if (input.name !== undefined && input.name !== current.value.name) {
		const clash = getDb()
			.select()
			.from(interfaces)
			.where(and(eq(interfaces.device_id, deviceId), eq(interfaces.name, input.name)))
			.get()
		if (clash) {
			return Result.err(
				new DuplicateError('This device already has an interface with this name'),
			)
		}
	}
	const patch: Partial<InterfaceRow> = {}
	if (input.name !== undefined) {
		patch.name = input.name
	}
	if (input.kind !== undefined) {
		patch.kind = input.kind
	}
	if (input.description !== undefined) {
		patch.description = input.description
	}
	if (!isPatchEmpty(patch)) {
		try {
			getDb().update(interfaces).set(patch).where(eq(interfaces.id, ifaceId)).run()
		} catch (err) {
			if (isUniqueViolation(err)) {
				return Result.err(
					new DuplicateError('This device already has an interface with this name'),
				)
			}
			return Result.err(err instanceof Error ? err : new Error(String(err)))
		}
	}
	return getInterface(deviceId, ifaceId)
}
