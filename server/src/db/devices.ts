import { Result } from 'better-result'
import { and, asc, count, eq, inArray, isNotNull, isNull, or, type SQL, sql } from 'drizzle-orm'
import type {
	DeviceCreate,
	DeviceMove,
	DeviceUpdate,
	InterfaceCreate,
	InterfaceUpdate,
} from 'shared/src/schemas'
import {
	device_roles,
	device_types,
	devices,
	external_links,
	interfaces,
	locations,
	manufacturers,
	racks,
	shelves,
	sites,
} from '../schema'
import { checkBounds, checkOverlap, type Face, faceOf } from '../services/occupancy'
import { expandStubs } from '../services/templates'
import { deviceHasCables } from './cables'
import { logCreate, logDelete, logUpdate } from './changelog'
import { getDb } from './connection'
import { checkDeviceRoleExists } from './device_roles'
import { ConflictError, DuplicateError, NotFoundError } from './errors'
import type { ListParams, Page, TenantFilterParams } from './list'
import {
	checkExists,
	checkTenantExists,
	findById,
	findOne,
	insertedId,
	isPatchEmpty,
	isTaken,
	offsetOf,
	orderOf,
	pageOf,
	pageRows,
	pickDefined,
	searchCondition,
	tenantConditions,
	tryWrite,
} from './list'
import { rackHeightOf, rackSpansOf } from './racks'
import { getDeviceType, stubsOf } from './templates'

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

interface MountInput {
	rack_id: number | null
	position_u: number | null
	face: Face
	is_full_depth: boolean
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
async function checkPlacement(
	deviceName: string,
	mount: MountInput,
	template: { u_height: number },
	excludeDeviceId?: number,
): Promise<Result<undefined, Error>> {
	if (mount.rack_id === null) {
		if (mount.position_u !== null) {
			return Result.err(new ConflictError('Unracked device cannot have a rack position'))
		}
		return Result.ok(undefined)
	}
	const rack = await findOne(racks, eq(racks.id, mount.rack_id))
	if (!rack) {
		return Result.err(new NotFoundError('Rack not found'))
	}
	if (mount.position_u === null) {
		// Rack-assigned but unmounted: displays as unracked, needs no U.
		return Result.ok(undefined)
	}
	if (template.u_height < 1) {
		return Result.err(new ConflictError('Device type must consume at least 1 U'))
	}
	const label = `Device "${deviceName}"`
	const candidate = {
		id: excludeDeviceId ?? 0,
		name: deviceName,
		position_u: mount.position_u,
		height_u: template.u_height,
		face: mount.face,
		is_full_depth: mount.is_full_depth,
	}
	const bounds = checkBounds(candidate, await rackHeightOf(rack), label)
	if (Result.isError(bounds)) {
		return bounds
	}
	return checkOverlap(candidate, await rackSpansOf(mount.rack_id), label, excludeDeviceId)
}

interface ShelfPlacementInput {
	rack_id?: number | null
	position_u?: number | null
	face?: Face
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
	const shelf = await findOne(shelves, eq(shelves.id, input.shelf_id))
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

/** Location must exist; when a site is also given it must belong to that site. */
async function checkLocation(
	locationId: number | null | undefined,
	siteId: number | null | undefined,
): Promise<Result<undefined, Error>> {
	if (locationId === null || locationId === undefined) {
		return Result.ok(undefined)
	}
	const location = await findOne(locations, eq(locations.id, locationId))
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
	const rack = await findOne(racks, eq(racks.id, rackId))
	return rack ? Result.ok(rack.location_id) : Result.err(new NotFoundError('Rack not found'))
}

const ASSET_TAG_IN_USE = 'Asset tag is already in use'
const DEVICE_ID_IN_USE = 'Device ID is already in use'

/** Asset tag / device ID uniqueness guard; `excludeDeviceId` skips the device being updated. */
async function checkDeviceUnique(
	input: { asset_tag?: string | null; device_id?: string | null },
	excludeDeviceId?: number,
): Promise<Result<undefined, Error>> {
	if (
		typeof input.asset_tag === 'string' &&
		(await isTaken(devices, eq(devices.asset_tag, input.asset_tag), excludeDeviceId))
	) {
		return Result.err(new DuplicateError(ASSET_TAG_IN_USE))
	}
	if (
		typeof input.device_id === 'string' &&
		(await isTaken(devices, eq(devices.device_id, input.device_id), excludeDeviceId))
	) {
		return Result.err(new DuplicateError(DEVICE_ID_IN_USE))
	}
	return Result.ok(undefined)
}

/** Maps a device unique violation to the colliding field (asset tag vs device ID). */
function duplicateDeviceError(err: unknown): Error {
	const message = err instanceof Error ? err.message : String(err)
	return new DuplicateError(message.includes('device_id') ? DEVICE_ID_IN_USE : ASSET_TAG_IN_USE)
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
	sort: 'name' | 'status' | 'device_id' | 'role' | 'type' | 'mount'
	order: 'asc' | 'desc'
}

export function listDevices(params: DeviceListParams): Promise<Page<DeviceRow>> {
	const where = and(
		params.search
			? or(
					searchCondition(params.search, [
						devices.name,
						devices.asset_tag,
						devices.device_id,
						devices.serial,
					]),
					inArray(
						devices.device_type_id,
						getDb()
							.select({ id: device_types.id })
							.from(device_types)
							.innerJoin(
								manufacturers,
								eq(manufacturers.id, device_types.manufacturer_id),
							)
							.where(
								searchCondition(params.search, [
									device_types.model,
									manufacturers.name,
								]),
							),
					),
				)
			: undefined,
		params.site ? eq(devices.site_id, params.site) : undefined,
		params.rack ? eq(devices.rack_id, params.rack) : undefined,
		params.role ? eq(devices.device_role_id, params.role) : undefined,
		...tenantConditions(devices.tenant_id, params),
		params.status ? eq(devices.status, params.status) : undefined,
		params.placed === undefined
			? undefined
			: params.placed
				? isNotNull(devices.position_u)
				: isNull(devices.position_u),
	)
	return pageRows(devices, where, [...deviceOrder(params), asc(devices.id)], params)
}

/** ORDER BY terms for a device list sort; related names via correlated subqueries. */
function deviceOrder(params: DeviceListParams): SQL[] {
	switch (params.sort) {
		case 'status':
			return [orderOf(devices.status, params.order)]
		case 'device_id':
			return [orderOf(devices.device_id, params.order)]
		case 'role':
			return [
				orderOf(
					sql`(SELECT ${device_roles.name} FROM ${device_roles} WHERE ${device_roles.id} = ${devices.device_role_id})`,
					params.order,
				),
			]
		case 'type':
			return [
				orderOf(
					sql`(SELECT ${device_types.model} FROM ${device_types} WHERE ${device_types.id} = ${devices.device_type_id})`,
					params.order,
				),
			]
		case 'mount':
			return [
				orderOf(
					sql`(SELECT ${racks.name} FROM ${racks} WHERE ${racks.id} = ${devices.rack_id})`,
					params.order,
				),
				orderOf(devices.position_u, params.order),
			]
		default:
			return [orderOf(devices.name, params.order)]
	}
}

export function getDevice(id: number): Promise<Result<DeviceRow, Error>> {
	return findById(devices, id, 'Device not found')
}

export async function createDevice(rawInput: DeviceCreate): Promise<Result<DeviceRow, Error>> {
	const normalized = await normalizeShelf(rawInput)
	if (Result.isError(normalized)) {
		return normalized
	}
	const input = normalized.value
	const template = await getDeviceType(input.device_type_id)
	if (Result.isError(template)) {
		return template
	}
	const mount: MountInput = {
		rack_id: input.rack_id ?? null,
		position_u: input.position_u ?? null,
		face: input.face ?? null,
		is_full_depth: template.value.is_full_depth !== 0,
	}
	let deviceLocationId = input.location_id ?? null
	const deviceSiteId = input.site_id ?? null
	if (mount.rack_id !== null) {
		const rackLocation = await rackLocationId(mount.rack_id)
		if (Result.isError(rackLocation)) {
			return rackLocation
		}
		deviceLocationId = rackLocation.value
	}
	for (const guard of [
		await checkExists(sites, deviceSiteId, 'Site not found'),
		await checkLocation(deviceLocationId, deviceSiteId),
		await checkTenantExists(input.tenant_id),
		await checkDeviceRoleExists(input.device_role_id),
		await checkDeviceUnique(input),
		await checkPlacement(input.name, mount, template.value),
	]) {
		if (Result.isError(guard)) {
			return guard
		}
	}
	// Stub rows are loaded before the transaction so a duplicate expansion
	// (e.g. from a concurrent stub edit) fails before anything is inserted.
	const expanded = expandStubs(await stubsOf(input.device_type_id))
	if (Result.isError(expanded)) {
		return Result.err(new ConflictError(expanded.error.message))
	}
	const values: Omit<DeviceRow, 'id'> = {
		device_type_id: input.device_type_id,
		device_role_id: input.device_role_id,
		site_id: deviceSiteId,
		location_id: deviceLocationId,
		rack_id: mount.rack_id,
		face: mount.face,
		position_u: mount.position_u,
		shelf_id: input.shelf_id ?? null,
		status: input.status ?? 'active',
		name: input.name,
		serial: input.serial ?? null,
		asset_tag: input.asset_tag ?? null,
		device_id: input.device_id ?? null,
		tenant_id: input.tenant_id ?? null,
		description: input.description ?? null,
	}
	const id = await tryWrite(
		() =>
			getDb().transaction(async (tx) => {
				const deviceId = insertedId(
					await tx.insert(devices).values(values).returning({ id: devices.id }),
				)
				for (const iface of expanded.value) {
					await tx.insert(interfaces).values({
						device_id: deviceId,
						name: iface.name,
						kind: iface.kind,
						connected: 0,
						description: iface.description ?? iface.label,
					})
				}
				return deviceId
			}),
		duplicateDeviceError,
	)
	if (Result.isError(id)) {
		return id
	}
	return await logCreate('device', await getDevice(id.value))
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
	const template = await getDeviceType(node.device_type_id)
	if (Result.isError(template)) {
		return template
	}
	const effectiveRackId = input.rack_id !== undefined ? input.rack_id : node.rack_id
	const mountChanged = input.rack_id !== undefined || input.position_u !== undefined
	const relocated = mountChanged && effectiveRackId !== null
	let deviceLocationId = input.location_id !== undefined ? input.location_id : node.location_id
	if (relocated) {
		const rackLocation = await rackLocationId(effectiveRackId)
		if (Result.isError(rackLocation)) {
			return rackLocation
		}
		deviceLocationId = rackLocation.value
	}
	for (const guard of [
		await checkExists(sites, input.site_id, 'Site not found'),
		await checkLocation(
			deviceLocationId,
			input.site_id !== undefined ? input.site_id : node.site_id,
		),
		await checkTenantExists(input.tenant_id),
		await checkDeviceUnique(input, id),
	]) {
		if (Result.isError(guard)) {
			return guard
		}
	}
	if (input.device_role_id !== undefined) {
		const roleCheck = await checkDeviceRoleExists(input.device_role_id)
		if (Result.isError(roleCheck)) {
			return roleCheck
		}
	}
	if (mountChanged || input.face !== undefined || input.name !== undefined) {
		const mount: MountInput = {
			rack_id: effectiveRackId,
			position_u: input.position_u !== undefined ? input.position_u : node.position_u,
			face: input.face !== undefined ? input.face : faceOf(node.face),
			is_full_depth: template.value.is_full_depth !== 0,
		}
		const mountCheck = await checkPlacement(input.name ?? node.name, mount, template.value, id)
		if (Result.isError(mountCheck)) {
			return mountCheck
		}
	}
	const patch: Partial<DeviceRow> = pickDefined(input, [
		'device_role_id',
		'name',
		'status',
		'site_id',
		'rack_id',
		'face',
		'position_u',
		'shelf_id',
		'serial',
		'asset_tag',
		'device_id',
		'tenant_id',
		'description',
	])
	if (input.location_id !== undefined || relocated) {
		patch.location_id = deviceLocationId
	}
	if (!isPatchEmpty(patch)) {
		const written = await tryWrite(
			() => getDb().update(devices).set(patch).where(eq(devices.id, id)),
			duplicateDeviceError,
		)
		if (Result.isError(written)) {
			return written
		}
	}
	return await logUpdate('device', node, await getDevice(id))
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
	const template = await getDeviceType(node.device_type_id)
	if (Result.isError(template)) {
		return template
	}
	const mount: MountInput = {
		rack_id: input.rack_id !== undefined ? input.rack_id : node.rack_id,
		position_u: input.position_u !== undefined ? input.position_u : node.position_u,
		face: faceOf(node.face),
		is_full_depth: template.value.is_full_depth !== 0,
	}
	const mountCheck = await checkPlacement(node.name, mount, template.value, id)
	if (Result.isError(mountCheck)) {
		return mountCheck
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
			return rackLocation
		}
		patch.location_id = rackLocation.value
	}
	const written = await tryWrite(() =>
		getDb().update(devices).set(patch).where(eq(devices.id, id)),
	)
	if (Result.isError(written)) {
		return written
	}
	return await logUpdate('device', node, await getDevice(id))
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
	const deleted = await tryWrite(() =>
		getDb().transaction(async (tx) => {
			await tx.delete(interfaces).where(eq(interfaces.device_id, id))
			await tx
				.delete(external_links)
				.where(
					and(eq(external_links.entity_type, 'device'), eq(external_links.entity_id, id)),
				)
			await tx.delete(devices).where(eq(devices.id, id))
		}),
	)
	if (Result.isError(deleted)) {
		return deleted
	}
	return await logDelete('device', current.value)
}

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

const INTERFACE_NAME_IN_USE = 'This device already has an interface with this name'

export async function listInterfaces(deviceId: number): Promise<Result<InterfaceJson[], Error>> {
	const device = await getDevice(deviceId)
	if (Result.isError(device)) {
		return device
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
	const where = and(
		searchCondition(params.search, [interfaces.name, interfaces.kind, devices.name]),
		params.device !== undefined ? eq(interfaces.device_id, params.device) : undefined,
		params.connected !== undefined
			? eq(interfaces.connected, params.connected ? 1 : 0)
			: undefined,
		params.scopeTenantId !== undefined
			? eq(devices.tenant_id, params.scopeTenantId)
			: undefined,
	)
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
	const row = await findOne(
		interfaces,
		and(eq(interfaces.id, ifaceId), eq(interfaces.device_id, deviceId)),
	)
	if (!row) {
		return Result.err(new NotFoundError('Interface not found on this device'))
	}
	return Result.ok(toInterfaceJson(row))
}

function interfaceNameTaken(deviceId: number, name: string): Promise<boolean> {
	return isTaken(interfaces, and(eq(interfaces.device_id, deviceId), eq(interfaces.name, name)))
}

export async function addInterface(
	deviceId: number,
	input: InterfaceCreate,
): Promise<Result<InterfaceJson, Error>> {
	const device = await getDevice(deviceId)
	if (Result.isError(device)) {
		return device
	}
	if (await interfaceNameTaken(deviceId, input.name)) {
		return Result.err(new DuplicateError(INTERFACE_NAME_IN_USE))
	}
	const row: Omit<InterfaceRow, 'id'> = {
		device_id: deviceId,
		name: input.name,
		kind: input.kind ?? 'ethernet',
		connected: 0,
		enabled: input.enabled === false ? 0 : 1,
		description: input.description ?? null,
	}
	const id = await tryWrite(
		async () =>
			insertedId(
				await getDb().insert(interfaces).values(row).returning({ id: interfaces.id }),
			),
		INTERFACE_NAME_IN_USE,
	)
	if (Result.isError(id)) {
		return id
	}
	return await logCreate('interface', await getInterface(deviceId, id.value))
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
	if (
		input.name !== undefined &&
		input.name !== current.value.name &&
		(await interfaceNameTaken(deviceId, input.name))
	) {
		return Result.err(new DuplicateError(INTERFACE_NAME_IN_USE))
	}
	const patch: Partial<InterfaceRow> = pickDefined(input, ['name', 'kind', 'description'])
	if (input.enabled !== undefined) {
		patch.enabled = input.enabled ? 1 : 0
	}
	if (!isPatchEmpty(patch)) {
		const written = await tryWrite(
			() => getDb().update(interfaces).set(patch).where(eq(interfaces.id, ifaceId)),
			INTERFACE_NAME_IN_USE,
		)
		if (Result.isError(written)) {
			return written
		}
	}
	return await logUpdate('interface', current.value, await getInterface(deviceId, ifaceId))
}
