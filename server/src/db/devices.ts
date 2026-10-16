import { Result } from 'better-result'
import {
	and,
	asc,
	count,
	eq,
	inArray,
	isNotNull,
	isNull,
	or,
	type SQL,
	type SQLWrapper,
	sql,
} from 'drizzle-orm'
import { alias, unionAll } from 'drizzle-orm/pg-core'
import type {
	DeviceCreate,
	DeviceListKind,
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
	virtual_machines,
} from '../schema'
import { checkBounds, checkOverlap, type Face, faceOf } from '../services/occupancy'
import { expandStubs } from '../services/templates'
import { prunePlacements } from './attachments'
import { deviceHasCables } from './cables'
import { logCreate, logDelete, logUpdate } from './changelog'
import { getDb, withTransaction } from './connection'
import { checkDeviceRoleExists, deviceRoleSubtree } from './device_roles'
import { checkEmployeeAssignment } from './employees'
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
	pickDefined,
	searchCondition,
	tenantConditions,
	tryWrite,
} from './list'
import { rackHeightOf, rackSpansOf } from './racks'
import { getDeviceType, stubsOf } from './templates'
import {
	deviceHasVirtualMachines,
	retenantHostedVms,
	type VirtualMachineRow,
} from './virtual_machines'

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
	device_type?: number
	employee?: number
	status?: string
	/** Placed = U-mounted; unplaced = position empty. */
	placed?: boolean
	/** Devices only, VMs only; `undefined` lists both. */
	kind?: DeviceListKind
	/** VMs running on this host device. */
	host?: number
	sort: 'name' | 'status' | 'device_id' | 'role' | 'type' | 'mount'
	order: 'asc' | 'desc'
}

/** One device list row: a physical device or a virtual machine (with its host's name). */
export type DeviceListItem =
	| ({ kind: 'device'; shelf_name: string | null; shelf_position_u: number | null } & DeviceRow)
	| ({ kind: 'vm'; host_name: string | null } & VirtualMachineRow)

const nullInt = (name: string): SQL.Aliased<number | null> =>
	sql<number | null>`NULL::integer`.as(name)
const nullText = (name: string): SQL.Aliased<string | null> =>
	sql<string | null>`NULL::text`.as(name)

/**
 * Devices and virtual machines in one list (`UNION ALL`), sorted and paged
 * together. Rack, device type, site and placed filters only apply to
 * devices and the host filter only to VMs, so setting one hides the other
 * kind. Sort keys are computed per branch (VMs sort by host name on
 * `mount` and have no type).
 */
export async function listDevices(params: DeviceListParams): Promise<Page<DeviceListItem>> {
	const db = getDb()
	// A role matches its descendant roles too (nested roles).
	const roleIds = params.role ? await deviceRoleSubtree(params.role) : undefined
	const deviceOnly =
		params.site !== undefined ||
		params.rack !== undefined ||
		params.device_type !== undefined ||
		params.placed !== undefined
	const deviceWhere =
		params.kind === 'vm' || params.host !== undefined
			? sql`false`
			: and(
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
									db
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
					roleIds ? inArray(devices.device_role_id, roleIds) : undefined,
					params.device_type ? eq(devices.device_type_id, params.device_type) : undefined,
					params.employee ? eq(devices.employee_id, params.employee) : undefined,
					...tenantConditions(devices.tenant_id, params),
					params.status ? eq(devices.status, params.status) : undefined,
					params.placed === undefined
						? undefined
						: params.placed
							? isNotNull(devices.position_u)
							: isNull(devices.position_u),
				)
	const vmWhere =
		params.kind === 'device' || deviceOnly
			? sql`false`
			: and(
					searchCondition(params.search, [virtual_machines.name]),
					params.host ? eq(virtual_machines.host_device_id, params.host) : undefined,
					roleIds ? inArray(virtual_machines.device_role_id, roleIds) : undefined,
					params.employee ? eq(virtual_machines.employee_id, params.employee) : undefined,
					...tenantConditions(virtual_machines.tenant_id, params),
					params.status ? eq(virtual_machines.status, params.status) : undefined,
				)
	const hosts = alias(devices, 'host')
	const deviceBranch = db
		.select({
			kind: sql<DeviceListKind>`'device'`.as('kind'),
			id: devices.id,
			name: devices.name,
			status: devices.status,
			device_role_id: devices.device_role_id,
			tenant_id: devices.tenant_id,
			employee_id: devices.employee_id,
			description: devices.description,
			device_type_id: sql<number | null>`${devices.device_type_id}`.as('device_type_id'),
			site_id: devices.site_id,
			location_id: devices.location_id,
			rack_id: devices.rack_id,
			face: devices.face,
			position_u: devices.position_u,
			shelf_id: devices.shelf_id,
			shelf_name: sql<string | null>`${shelves.name}`.as('shelf_name'),
			shelf_position_u: sql<number | null>`${shelves.position_u}`.as('shelf_position_u'),
			serial: devices.serial,
			asset_tag: devices.asset_tag,
			device_id: devices.device_id,
			host_device_id: nullInt('host_device_id'),
			sort_role: sql<string>`${device_roles.name}`.as('sort_role'),
			sort_type: sql<string | null>`${device_types.model}`.as('sort_type'),
			sort_mount: sql<string | null>`${racks.name}`.as('sort_mount'),
		})
		.from(devices)
		.innerJoin(device_roles, eq(device_roles.id, devices.device_role_id))
		.innerJoin(device_types, eq(device_types.id, devices.device_type_id))
		.leftJoin(racks, eq(racks.id, devices.rack_id))
		.leftJoin(shelves, eq(shelves.id, devices.shelf_id))
		.where(deviceWhere)
	const vmBranch = db
		.select({
			kind: sql<DeviceListKind>`'vm'`.as('kind'),
			id: virtual_machines.id,
			name: virtual_machines.name,
			status: virtual_machines.status,
			device_role_id: virtual_machines.device_role_id,
			tenant_id: virtual_machines.tenant_id,
			employee_id: virtual_machines.employee_id,
			description: virtual_machines.description,
			device_type_id: nullInt('device_type_id'),
			site_id: nullInt('site_id'),
			location_id: nullInt('location_id'),
			rack_id: nullInt('rack_id'),
			face: nullText('face'),
			position_u: nullInt('position_u'),
			shelf_id: nullInt('shelf_id'),
			shelf_name: nullText('shelf_name'),
			shelf_position_u: nullInt('shelf_position_u'),
			serial: nullText('serial'),
			asset_tag: nullText('asset_tag'),
			device_id: nullText('device_id'),
			host_device_id: virtual_machines.host_device_id,
			sort_role: sql<string>`${device_roles.name}`.as('sort_role'),
			sort_type: nullText('sort_type'),
			sort_mount: sql<string | null>`${hosts.name}`.as('sort_mount'),
		})
		.from(virtual_machines)
		.innerJoin(device_roles, eq(device_roles.id, virtual_machines.device_role_id))
		.leftJoin(hosts, eq(hosts.id, virtual_machines.host_device_id))
		.where(vmWhere)
	const rows = db.$with('device_list').as(unionAll(deviceBranch, vmBranch))
	const items = await db
		.with(rows)
		.select()
		.from(rows)
		.orderBy(...deviceOrder(rows, params), asc(rows.kind), asc(rows.id))
		.limit(params.limit)
		.offset(offsetOf(params))
	const total = (await db.with(rows).select({ n: count() }).from(rows))[0]?.n ?? 0
	return pageOf(items.map(toListItem), total, params)
}

/** A raw union row: the columns of both kinds, the other kind's ones null. */
type DeviceListRow = Omit<DeviceRow, 'device_type_id'> & {
	kind: DeviceListKind
	shelf_name: string | null
	shelf_position_u: number | null
	device_type_id: number | null
	host_device_id: number | null
	sort_mount: string | null
}

/** Narrows a union row to its kind's columns. */
function toListItem(row: DeviceListRow): DeviceListItem {
	const shared = {
		id: row.id,
		name: row.name,
		status: row.status,
		device_role_id: row.device_role_id,
		tenant_id: row.tenant_id,
		employee_id: row.employee_id,
		description: row.description,
	}
	if (row.kind === 'vm') {
		return {
			kind: 'vm',
			...shared,
			host_device_id: row.host_device_id,
			host_name: row.sort_mount,
		}
	}
	return {
		kind: 'device',
		...shared,
		device_type_id: row.device_type_id ?? 0,
		site_id: row.site_id,
		location_id: row.location_id,
		rack_id: row.rack_id,
		face: row.face,
		position_u: row.position_u,
		shelf_id: row.shelf_id,
		shelf_name: row.shelf_name,
		shelf_position_u: row.shelf_position_u,
		serial: row.serial,
		asset_tag: row.asset_tag,
		device_id: row.device_id,
	}
}

/** ORDER BY terms for a device list sort over the union's sort keys. */
function deviceOrder(
	rows: {
		name: SQLWrapper
		status: SQLWrapper
		device_id: SQLWrapper
		position_u: SQLWrapper
		sort_role: SQLWrapper
		sort_type: SQLWrapper
		sort_mount: SQLWrapper
	},
	params: DeviceListParams,
): SQL[] {
	switch (params.sort) {
		case 'status':
			return [orderOf(rows.status, params.order)]
		case 'device_id':
			return [orderOf(rows.device_id, params.order)]
		case 'role':
			return [orderOf(rows.sort_role, params.order)]
		case 'type':
			return [orderOf(rows.sort_type, params.order)]
		case 'mount':
			return [orderOf(rows.sort_mount, params.order), orderOf(rows.position_u, params.order)]
		default:
			return [orderOf(rows.name, params.order)]
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
		await checkEmployeeAssignment(input.employee_id, input.tenant_id),
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
		employee_id: input.employee_id ?? null,
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
		await checkEmployeeAssignment(
			input.employee_id !== undefined ? input.employee_id : node.employee_id,
			input.tenant_id !== undefined ? input.tenant_id : node.tenant_id,
		),
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
		'employee_id',
		'description',
	])
	if (input.location_id !== undefined || relocated) {
		patch.location_id = deviceLocationId
	}
	if (!isPatchEmpty(patch)) {
		// Another site or location can take the device out of its floor plan's
		// scope; another tenant moves the VMs it hosts along.
		const written = await tryWrite(
			() =>
				withTransaction(async () => {
					await getDb().update(devices).set(patch).where(eq(devices.id, id))
					if (patch.tenant_id !== undefined && patch.tenant_id !== node.tenant_id) {
						await retenantHostedVms(id, patch.tenant_id)
					}
					if (
						(patch.site_id !== undefined && patch.site_id !== node.site_id) ||
						(patch.location_id !== undefined && patch.location_id !== node.location_id)
					) {
						await prunePlacements()
					}
				}),
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
		withTransaction(async () => {
			await getDb().update(devices).set(patch).where(eq(devices.id, id))
			if (patch.location_id !== undefined && patch.location_id !== node.location_id) {
				await prunePlacements()
			}
		}),
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
	if (await deviceHasVirtualMachines(id)) {
		return Result.err(
			new ConflictError('Device still hosts virtual machines; move or delete them first'),
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
