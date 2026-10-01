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
	external_links,
	interfaces,
	locations,
	racks,
	shelves,
	sites,
} from '../schema'
import { checkBounds, checkOverlap } from '../services/occupancy'
import { expandStubs } from '../services/templates'
import { deviceHasCables } from './cables'
import { logCreate, logDelete, logUpdate } from './changelog'
import { getDb } from './connection'
import { checkDeviceRoleExists } from './device_roles'
import { ConflictError, DuplicateError, isUniqueViolation, NotFoundError } from './errors'
import type { ListParams, Page, TenantFilterParams } from './list'
import {
	checkTenantExists,
	errOf,
	isPatchEmpty,
	offsetOf,
	pageOf,
	searchPattern,
	tenantConditions,
} from './list'
import { rackHeightOf, rackSpansOf } from './racks'

export type DeviceRow = typeof devices.$inferSelect
export type InterfaceRow = typeof interfaces.$inferSelect

/**
 * Wire shape of an interface: `connected` (P5 flips it) and `enabled` read
 * as booleans.
 */
export interface InterfaceJson extends Omit<InterfaceRow, 'connected' | 'enabled'> {
	connected: boolean
	enabled: boolean
}

function toInterfaceJson(row: InterfaceRow): InterfaceJson {
	return { ...row, connected: row.connected !== 0, enabled: row.enabled !== 0 }
}

// ---------------------------------------------------------------------------
// Placement validation
// ---------------------------------------------------------------------------

export interface MountInput {
	rack_id: number | null
	position_u: number | null
	face: 'front' | 'rear' | null
	is_full_depth: boolean
}

export interface PlacementTemplate {
	u_height: number
}

function templateOf(row: { u_height: number }): PlacementTemplate {
	return {
		u_height: row.u_height,
	}
}

/**
 * Placement states (exactly one):
 * | unracked           | rack null | position null | any u_height |
 * | rack-assigned only | rack set  | position null | any          |
 * | U-mounted          | rack set  | position set  | >= 1         |
 *
 * Shelves live in their own table and only compete for U space, so mounts
 * validate against devices plus shelf blockers. `excludeDeviceId` skips
 * the device being updated so a no-op move is not self-conflicting.
 */
export async function checkPlacement(
	deviceName: string,
	mount: MountInput,
	template: PlacementTemplate,
	excludeDeviceId?: number,
): Promise<Result<undefined, Error>> {
	const db = getDb()
	if (mount.rack_id === null) {
		if (mount.position_u !== null) {
			return Result.err(new ConflictError('Unracked device cannot have a rack position'))
		}
		return Result.ok(undefined)
	}
	const rack = (await db.select().from(racks).where(eq(racks.id, mount.rack_id)).limit(1))[0]
	if (!rack) {
		return Result.err(new NotFoundError('Rack not found'))
	}
	if (mount.position_u === null) {
		// Rack-assigned but unmounted: displays as unracked, needs no U.
		return Result.ok(undefined)
	}
	const positionU = mount.position_u as number
	if (template.u_height < 1) {
		return Result.err(new ConflictError('Device type must consume at least 1 U'))
	}
	const candidate = {
		id: excludeDeviceId ?? 0,
		name: deviceName,
		position_u: positionU,
		height_u: template.u_height,
		face: mount.face,
		is_full_depth: mount.is_full_depth,
	}
	const bounds = checkBounds(candidate, await rackHeightOf(rack), `Device "${deviceName}"`)
	if (Result.isError(bounds)) {
		return Result.err(bounds.error)
	}
	const overlap = checkOverlap(
		candidate,
		await rackSpansOf(mount.rack_id),
		`Device "${deviceName}"`,
		excludeDeviceId,
	)
	if (Result.isError(overlap)) {
		return Result.err(overlap.error)
	}
	return Result.ok(undefined)
}

interface ShelfPlacementInput {
	rack_id?: number | null
	position_u?: number | null
	face?: 'front' | 'rear' | null
	shelf_id?: number | null
}

/**
 * Normalizes the shelf half of a placement. Placing on a shelf pins the
 * rack to the shelf's rack and clears U position and face; moving a shelved
 * device to another rack or onto a U takes it off its shelf.
 */
async function normalizeShelf<T extends ShelfPlacementInput>(
	input: T,
	current?: { rack_id: number | null; shelf_id: number | null },
): Promise<Result<T, Error>> {
	if (input.shelf_id === undefined || input.shelf_id === null) {
		const leavesShelf =
			input.shelf_id === undefined &&
			current?.shelf_id !== null &&
			current?.shelf_id !== undefined &&
			((input.rack_id !== undefined && input.rack_id !== current.rack_id) ||
				(input.position_u !== undefined && input.position_u !== null))
		return Result.ok(leavesShelf ? { ...input, shelf_id: null } : input)
	}
	const shelf = (
		await getDb().select().from(shelves).where(eq(shelves.id, input.shelf_id)).limit(1)
	)[0]
	if (!shelf) {
		return Result.err(new NotFoundError('Shelf not found'))
	}
	if (input.rack_id !== undefined && input.rack_id !== null && input.rack_id !== shelf.rack_id) {
		return Result.err(new ConflictError('Shelf is mounted in another rack'))
	}
	if (input.position_u !== undefined && input.position_u !== null) {
		return Result.err(new ConflictError('A device on a shelf has no U position'))
	}
	return Result.ok({ ...input, rack_id: shelf.rack_id, position_u: null, face: null })
}

/** Backwards-compatible alias for the placement check. */
export const checkMount: typeof checkPlacement = checkPlacement

async function checkSite(siteId: number | null | undefined): Promise<Result<undefined, Error>> {
	if (siteId === null || siteId === undefined) {
		return Result.ok(undefined)
	}
	if (!(await getDb().select().from(sites).where(eq(sites.id, siteId)).limit(1))[0]) {
		return Result.err(new NotFoundError('Site not found'))
	}
	return Result.ok(undefined)
}

/** Location must exist; when a site is also given it must belong to that site. */
async function checkLocation(
	locationId: number | null | undefined,
	siteId: number | null | undefined,
): Promise<Result<undefined, Error>> {
	if (locationId === null || locationId === undefined) {
		return Result.ok(undefined)
	}
	const location = (
		await getDb().select().from(locations).where(eq(locations.id, locationId)).limit(1)
	)[0]
	if (!location) {
		return Result.err(new NotFoundError('Location not found'))
	}
	if (siteId !== null && siteId !== undefined && location.site_id !== siteId) {
		return Result.err(new NotFoundError('Location not found in this site'))
	}
	return Result.ok(undefined)
}

/** The rack location is authoritative for a rack-mounted device. */
async function rackLocationId(rackId: number): Promise<Result<number | null, Error>> {
	const rack = (
		await getDb()
			.select({ location_id: racks.location_id })
			.from(racks)
			.where(eq(racks.id, rackId))
			.limit(1)
	)[0]
	if (!rack) {
		return Result.err(new NotFoundError('Rack not found'))
	}
	return Result.ok(rack.location_id)
}

async function checkAssetTag(
	assetTag: string | null | undefined,
	excludeDeviceId?: number,
): Promise<Result<undefined, Error>> {
	if (assetTag === null || assetTag === undefined) {
		return Result.ok(undefined)
	}
	const clash = (
		await getDb().select().from(devices).where(eq(devices.asset_tag, assetTag)).limit(1)
	)[0]
	if (clash && clash.id !== excludeDeviceId) {
		return Result.err(new DuplicateError('Asset tag is already in use'))
	}
	return Result.ok(undefined)
}

async function checkDeviceId(
	deviceId: string | null | undefined,
	excludeDeviceId?: number,
): Promise<Result<undefined, Error>> {
	if (deviceId === null || deviceId === undefined) {
		return Result.ok(undefined)
	}
	const clash = (
		await getDb().select().from(devices).where(eq(devices.device_id, deviceId)).limit(1)
	)[0]
	if (clash && clash.id !== excludeDeviceId) {
		return Result.err(new DuplicateError('Device ID is already in use'))
	}
	return Result.ok(undefined)
}

/** Maps a device unique violation to the colliding field (asset tag vs device ID). */
function duplicateDeviceError(err: unknown): Error {
	const message = err instanceof Error ? err.message : String(err)
	if (message.includes('device_id')) {
		return new DuplicateError('Device ID is already in use')
	}
	if (message.includes('asset_tag')) {
		return new DuplicateError('Asset tag is already in use')
	}
	return new DuplicateError('Asset tag is already in use')
}

// ---------------------------------------------------------------------------
// Devices
// ---------------------------------------------------------------------------

export interface DeviceListParams extends ListParams, TenantFilterParams {
	site?: number
	rack?: number
	role?: number
	status?: string
	/** Placed = U-mounted; unplaced = position empty. */
	placed?: boolean
	sort: 'name' | 'status'
	order: 'asc' | 'desc'
}

export async function listDevices(params: DeviceListParams): Promise<Page<DeviceRow>> {
	const db = getDb()
	const pattern = searchPattern(params.search)
	const conditions: SQL[] = []
	if (params.search) {
		conditions.push(
			sql`(${devices.name} ILIKE ${pattern} ESCAPE '\\' OR ${devices.asset_tag} ILIKE ${pattern} ESCAPE '\\' OR ${devices.device_id} ILIKE ${pattern} ESCAPE '\\' OR ${devices.serial} ILIKE ${pattern} ESCAPE '\\')`,
		)
	}
	if (params.site) {
		conditions.push(eq(devices.site_id, params.site))
	}
	if (params.rack) {
		conditions.push(eq(devices.rack_id, params.rack))
	}
	if (params.role) {
		conditions.push(eq(devices.device_role_id, params.role))
	}
	conditions.push(...tenantConditions(devices.tenant_id, params))
	if (params.status) {
		conditions.push(eq(devices.status, params.status))
	}
	if (params.placed !== undefined) {
		conditions.push(
			params.placed
				? sql`${devices.position_u} IS NOT NULL`
				: sql`${devices.position_u} IS NULL`,
		)
	}
	const where = conditions.length > 0 ? and(...conditions) : undefined
	const orderColumn = params.sort === 'status' ? devices.status : devices.name
	const items = await db
		.select()
		.from(devices)
		.where(where)
		.orderBy(params.order === 'desc' ? desc(orderColumn) : asc(orderColumn), asc(devices.id))
		.limit(params.limit)
		.offset(offsetOf(params))
	const totalRow = (await db.select({ n: count() }).from(devices).where(where).limit(1))[0]
	return pageOf(items, totalRow?.n ?? 0, params)
}

export async function getDevice(id: number): Promise<Result<DeviceRow, Error>> {
	const row = (await getDb().select().from(devices).where(eq(devices.id, id)).limit(1))[0]
	if (!row) {
		return Result.err(new NotFoundError('Device not found'))
	}
	return Result.ok(row)
}

function mountOf(input: {
	rack_id?: number | null
	position_u?: number | null
	face?: 'front' | 'rear' | null
	is_full_depth?: boolean
}): MountInput {
	return {
		rack_id: input.rack_id ?? null,
		position_u: input.position_u ?? null,
		face: input.face ?? null,
		is_full_depth: input.is_full_depth ?? true,
	}
}

export async function createDevice(rawInput: DeviceCreate): Promise<Result<DeviceRow, Error>> {
	const db = getDb()
	const normalized = await normalizeShelf(rawInput)
	if (Result.isError(normalized)) {
		return normalized
	}
	const input = normalized.value
	const template = (
		await db
			.select()
			.from(device_types)
			.where(eq(device_types.id, input.device_type_id))
			.limit(1)
	)[0]
	if (!template) {
		return Result.err(new NotFoundError('Device type not found'))
	}
	const createMount = mountOf(input)
	createMount.is_full_depth = template.is_full_depth !== 0
	let deviceLocationId = input.location_id ?? null
	const deviceSiteId = input.site_id ?? null
	if (createMount.rack_id !== null) {
		const rackLocation = await rackLocationId(createMount.rack_id)
		if (Result.isError(rackLocation)) {
			return Result.err(rackLocation.error)
		}
		deviceLocationId = rackLocation.value
	}
	for (const guard of [
		await checkSite(deviceSiteId),
		await checkLocation(deviceLocationId, deviceSiteId),
		await checkTenantExists(input.tenant_id),
		await checkDeviceRoleExists(input.device_role_id),
		await checkAssetTag(input.asset_tag),
		await checkDeviceId(input.device_id),
		await checkPlacement(input.name, createMount, templateOf(template)),
	]) {
		if (Result.isError(guard)) {
			return Result.err(guard.error)
		}
	}
	// Stub rows are loaded before the transaction so a duplicate expansion
	// (e.g. from a concurrent stub edit) fails before anything is inserted.
	const stubs = await db
		.select()
		.from(device_type_interfaces)
		.where(eq(device_type_interfaces.device_type_id, input.device_type_id))
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
		device_role_id: input.device_role_id,
		site_id: deviceSiteId,
		location_id: deviceLocationId,
		rack_id: input.rack_id ?? null,
		face: input.face ?? null,
		position_u: input.position_u ?? null,
		shelf_id: input.shelf_id ?? null,
		status: input.status ?? 'active',
		name: input.name,
		serial: input.serial ?? null,
		asset_tag: input.asset_tag ?? null,
		device_id: input.device_id ?? null,
		tenant_id: input.tenant_id ?? null,
		description: input.description ?? null,
	}
	let deviceId: number | undefined
	try {
		await db.transaction(async (tx) => {
			const inserted = (
				await tx.insert(devices).values(values).returning({ id: devices.id })
			)[0]
			if (!inserted) {
				throw new Error('Device insert did not return an id')
			}
			deviceId = inserted.id
			for (const iface of expanded.value) {
				await tx.insert(interfaces).values({
					device_id: inserted.id,
					name: iface.name,
					kind: iface.kind,
					connected: 0,
					description: iface.description ?? iface.label,
				})
			}
		})
	} catch (err) {
		if (isUniqueViolation(err)) {
			return Result.err(duplicateDeviceError(err))
		}
		return Result.err(err instanceof Error ? err : new Error(String(err)))
	}
	if (deviceId === undefined) {
		return Result.err(new Error('Device insert did not return an id'))
	}
	return await logCreate('device', await getDevice(deviceId))
}

export async function updateDevice(
	id: number,
	rawInput: DeviceUpdate,
): Promise<Result<DeviceRow, Error>> {
	const current = await getDevice(id)
	if (Result.isError(current)) {
		return current
	}
	const node = current.value
	const normalized = await normalizeShelf(rawInput, node)
	if (Result.isError(normalized)) {
		return normalized
	}
	const input = normalized.value
	const template = (
		await getDb()
			.select()
			.from(device_types)
			.where(eq(device_types.id, node.device_type_id))
			.limit(1)
	)[0]
	if (!template) {
		return Result.err(new NotFoundError('Device type not found'))
	}
	const placement = templateOf(template)
	const effectiveRackId = input.rack_id !== undefined ? input.rack_id : node.rack_id
	const mountChanged = input.rack_id !== undefined || input.position_u !== undefined
	let deviceLocationId = input.location_id !== undefined ? input.location_id : node.location_id
	if (mountChanged && effectiveRackId !== null && effectiveRackId !== undefined) {
		const rackLocation = await rackLocationId(effectiveRackId)
		if (Result.isError(rackLocation)) {
			return Result.err(rackLocation.error)
		}
		deviceLocationId = rackLocation.value
	}
	for (const guard of [
		await checkSite(input.site_id),
		await checkLocation(
			deviceLocationId,
			input.site_id !== undefined ? input.site_id : node.site_id,
		),
		await checkTenantExists(input.tenant_id),
		await checkAssetTag(input.asset_tag, id),
		await checkDeviceId(input.device_id, id),
	]) {
		if (Result.isError(guard)) {
			return Result.err(guard.error)
		}
	}
	if (input.device_role_id !== undefined) {
		const roleCheck = await checkDeviceRoleExists(input.device_role_id)
		if (Result.isError(roleCheck)) {
			return Result.err(roleCheck.error)
		}
	}
	const mount: MountInput = {
		rack_id: effectiveRackId ?? null,
		position_u: input.position_u !== undefined ? input.position_u : node.position_u,
		face:
			input.face !== undefined
				? input.face
				: node.face === 'front' || node.face === 'rear'
					? node.face
					: null,
		is_full_depth: template.is_full_depth !== 0,
	}
	if (mountChanged || input.face !== undefined || input.name !== undefined) {
		const mountCheck = await checkPlacement(input.name ?? node.name, mount, placement, id)
		if (Result.isError(mountCheck)) {
			return Result.err(mountCheck.error)
		}
	}
	const patch: Partial<DeviceRow> = {}
	if (input.device_role_id !== undefined) {
		patch.device_role_id = input.device_role_id
	}
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
	if (input.device_id !== undefined) {
		patch.device_id = input.device_id
	}
	if (input.tenant_id !== undefined) {
		patch.tenant_id = input.tenant_id
	}
	if (input.description !== undefined) {
		patch.description = input.description
	}
	if (!isPatchEmpty(patch)) {
		try {
			await getDb().update(devices).set(patch).where(eq(devices.id, id))
		} catch (err) {
			if (isUniqueViolation(err)) {
				return Result.err(duplicateDeviceError(err))
			}
			return Result.err(err instanceof Error ? err : new Error(String(err)))
		}
	}
	return await logUpdate('device', current.value, await getDevice(id))
}

/**
 * Explicit remount: `undefined` keeps the current mount value, `null` clears
 * it. The effective mount re-validates U exactly like creation.
 */
export async function moveDevice(id: number, input: DeviceMove): Promise<Result<DeviceRow, Error>> {
	const current = await getDevice(id)
	if (Result.isError(current)) {
		return current
	}
	const node = current.value
	const template = (
		await getDb()
			.select()
			.from(device_types)
			.where(eq(device_types.id, node.device_type_id))
			.limit(1)
	)[0]
	if (!template) {
		return Result.err(new NotFoundError('Device type not found'))
	}
	const placement = templateOf(template)
	const mount: MountInput = {
		rack_id: input.rack_id !== undefined ? input.rack_id : node.rack_id,
		position_u: input.position_u !== undefined ? input.position_u : node.position_u,
		face: node.face === 'front' || node.face === 'rear' ? node.face : null,
		is_full_depth: template.is_full_depth !== 0,
	}
	const mountCheck = await checkPlacement(node.name, mount, placement, id)
	if (Result.isError(mountCheck)) {
		return Result.err(mountCheck.error)
	}
	const patch: Partial<DeviceRow> = {
		rack_id: mount.rack_id,
		position_u: mount.position_u,
	}
	// A remount (other rack or a U) takes the device off its shelf.
	if (mount.rack_id !== node.rack_id || mount.position_u !== null) {
		patch.shelf_id = null
	}
	if (mount.rack_id !== null) {
		const rackLocation = await rackLocationId(mount.rack_id)
		if (Result.isError(rackLocation)) {
			return Result.err(rackLocation.error)
		}
		patch.location_id = rackLocation.value
	}
	try {
		await getDb().update(devices).set(patch).where(eq(devices.id, id))
	} catch (err) {
		return Result.err(err instanceof Error ? err : new Error(String(err)))
	}
	return await logUpdate('device', current.value, await getDevice(id))
}

export async function deleteDevice(id: number): Promise<Result<DeviceRow, Error>> {
	const current = await getDevice(id)
	if (Result.isError(current)) {
		return current
	}
	// Cabled ports stay consistent: remove cables first so no peer is left
	// pointing at a deleted interface (FK + connected flag both matter).
	if (await deviceHasCables(id)) {
		return Result.err(
			new ConflictError('Device still has connected cables; disconnect them first'),
		)
	}
	try {
		await getDb().transaction(async (tx) => {
			await tx.delete(interfaces).where(eq(interfaces.device_id, id))
			await tx
				.delete(external_links)
				.where(
					and(eq(external_links.entity_type, 'device'), eq(external_links.entity_id, id)),
				)
			await tx.delete(devices).where(eq(devices.id, id))
		})
	} catch (e) {
		return Result.err(errOf(e))
	}
	return await logDelete('device', current.value)
}

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export async function listInterfaces(deviceId: number): Promise<Result<InterfaceJson[], Error>> {
	const device = await getDevice(deviceId)
	if (Result.isError(device)) {
		return Result.err(device.error)
	}
	const rows = await getDb()
		.select()
		.from(interfaces)
		.where(eq(interfaces.device_id, deviceId))
		// Creation order, not name order: stub expansion inserts eth1..eth24
		// sequentially, so the list reads back in natural port order
		// (lexicographic name order would put eth10 before eth2).
		.orderBy(asc(interfaces.id))
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
export async function listAllInterfaces(
	params: InterfaceListParams,
): Promise<Page<InterfaceListItem>> {
	const db = getDb()
	const pattern = searchPattern(params.search)
	const conditions: SQL[] = []
	if (params.search) {
		conditions.push(
			sql`(${interfaces.name} ILIKE ${pattern} ESCAPE '\\' OR ${interfaces.kind} ILIKE ${pattern} ESCAPE '\\' OR ${devices.name} ILIKE ${pattern} ESCAPE '\\')`,
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
	const rows = await db
		.select({ iface: interfaces, device_name: devices.name })
		.from(interfaces)
		.innerJoin(devices, eq(interfaces.device_id, devices.id))
		.where(where)
		.orderBy(asc(devices.name), asc(interfaces.id))
		.limit(params.limit)
		.offset(offsetOf(params))
	const totalRow = (
		await db
			.select({ n: count() })
			.from(interfaces)
			.innerJoin(devices, eq(interfaces.device_id, devices.id))
			.where(where)
			.limit(1)
	)[0]
	return pageOf(
		rows.map((r) => ({ ...toInterfaceJson(r.iface), device_name: r.device_name })),
		totalRow?.n ?? 0,
		params,
	)
}

export async function getInterface(
	deviceId: number,
	ifaceId: number,
): Promise<Result<InterfaceJson, Error>> {
	const row = (
		await getDb().select().from(interfaces).where(eq(interfaces.id, ifaceId)).limit(1)
	)[0]
	if (!row || row.device_id !== deviceId) {
		return Result.err(new NotFoundError('Interface not found on this device'))
	}
	return Result.ok(toInterfaceJson(row))
}

export async function addInterface(
	deviceId: number,
	input: InterfaceCreate,
): Promise<Result<InterfaceJson, Error>> {
	const device = await getDevice(deviceId)
	if (Result.isError(device)) {
		return Result.err(device.error)
	}
	const clash = (
		await getDb()
			.select()
			.from(interfaces)
			.where(and(eq(interfaces.device_id, deviceId), eq(interfaces.name, input.name)))
			.limit(1)
	)[0]
	if (clash) {
		return Result.err(new DuplicateError('This device already has an interface with this name'))
	}
	const row: Omit<InterfaceRow, 'id'> = {
		device_id: deviceId,
		name: input.name,
		kind: input.kind ?? 'ethernet',
		connected: 0,
		enabled: input.enabled === false ? 0 : 1,
		description: input.description ?? null,
	}
	try {
		const inserted = (
			await getDb().insert(interfaces).values(row).returning({ id: interfaces.id })
		)[0]
		if (!inserted) {
			return Result.err(new Error('Interface insert did not return an id'))
		}
		return await logCreate('interface', await getInterface(deviceId, inserted.id))
	} catch (err) {
		if (isUniqueViolation(err)) {
			return Result.err(
				new DuplicateError('This device already has an interface with this name'),
			)
		}
		return Result.err(err instanceof Error ? err : new Error(String(err)))
	}
}

export async function updateInterface(
	deviceId: number,
	ifaceId: number,
	input: InterfaceUpdate,
): Promise<Result<InterfaceJson, Error>> {
	const current = await getInterface(deviceId, ifaceId)
	if (Result.isError(current)) {
		return current
	}
	if (input.name !== undefined && input.name !== current.value.name) {
		const clash = (
			await getDb()
				.select()
				.from(interfaces)
				.where(and(eq(interfaces.device_id, deviceId), eq(interfaces.name, input.name)))
				.limit(1)
		)[0]
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
	if (input.enabled !== undefined) {
		patch.enabled = input.enabled ? 1 : 0
	}
	if (!isPatchEmpty(patch)) {
		try {
			await getDb().update(interfaces).set(patch).where(eq(interfaces.id, ifaceId))
		} catch (err) {
			if (isUniqueViolation(err)) {
				return Result.err(
					new DuplicateError('This device already has an interface with this name'),
				)
			}
			return Result.err(err instanceof Error ? err : new Error(String(err)))
		}
	}
	return await logUpdate('interface', current.value, await getInterface(deviceId, ifaceId))
}
