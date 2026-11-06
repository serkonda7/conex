import { Result } from 'better-result'
import {
	and,
	asc,
	count,
	eq,
	getTableColumns,
	gte,
	inArray,
	isNotNull,
	isNull,
	lt,
	or,
	type SQL,
	sql,
} from 'drizzle-orm'
import type {
	DeviceTypeCreate,
	DeviceTypeEolFilter,
	DeviceTypeListQuery,
	DeviceTypeUpdate,
	ManufacturerCreate,
	ManufacturerListQuery,
	ManufacturerUpdate,
	StubCreate,
	StubUpdate,
} from 'shared/src/schemas'
import {
	device_roles,
	device_type_interfaces,
	device_types,
	devices,
	manufacturers,
	rack_types,
	racks,
} from '../schema'
import { checkBounds, checkOverlap, faceOf } from '../services/occupancy'
import { expandStubs, type StubInput, stubPowerError } from '../services/templates'
import { logCreate, logDelete, logUpdate } from './changelog'
import { getDb } from './connection'
import { deviceRoleSubtrees } from './device_roles'
import { ConflictError, DuplicateError, NotFoundError } from './errors'
import type { ListParams, Page } from './list'
import {
	checkExists,
	countWhere,
	exists,
	findById,
	findOne,
	insertedId,
	isPatchEmpty,
	isTaken,
	orderOf,
	pageRows,
	pickDefined,
	searchCondition,
	subquery,
	tryWrite,
} from './list'
import { rackHeightOf, rackSpansOf } from './racks'

export type ManufacturerRow = typeof manufacturers.$inferSelect
export type DeviceTypeRow = typeof device_types.$inferSelect
export type StubRow = typeof device_type_interfaces.$inferSelect
/** Catalog and usage counts; `past_eol_count`: devices whose type is past its EOL date. */
export type ManufacturerListRow = ManufacturerRow & {
	device_type_count: number
	rack_type_count: number
	device_count: number
	past_eol_count: number
}
/** `instance_count`: devices built from the type. */
export type DeviceTypeListRow = DeviceTypeRow & { instance_count: number }

// ---------------------------------------------------------------------------
// Manufacturers
// ---------------------------------------------------------------------------

const MANUFACTURER_NAME_IN_USE = 'Manufacturer name is already in use'

export interface ManufacturerListParams extends ListParams {
	sort: ManufacturerListQuery['sort']
	order: 'asc' | 'desc'
}

/** Devices built from a type of the outer manufacturer row, optionally narrowed. */
function manufacturerDevices(where?: SQL): SQL<number> {
	return sql<number>`(${subquery
		.select({ n: count() })
		.from(devices)
		.innerJoin(device_types, eq(device_types.id, devices.device_type_id))
		.where(and(eq(device_types.manufacturer_id, manufacturers.id), where))})`.mapWith(Number)
}

/** Catalog and usage counts of the outer manufacturer row (`ManufacturerListRow`). */
const manufacturerCounts = {
	device_type_count: countWhere(device_types.manufacturer_id, manufacturers.id),
	rack_type_count: countWhere(rack_types.manufacturer_id, manufacturers.id),
	device_count: manufacturerDevices(),
	past_eol_count: manufacturerDevices(lt(device_types.eol_date, sql`CURRENT_DATE`)),
}

export async function listManufacturers(
	params: ManufacturerListParams,
): Promise<Page<ManufacturerListRow>> {
	const orderColumns = {
		name: manufacturers.name,
		description: manufacturers.description,
		website: manufacturers.website,
		support_url: manufacturers.support_url,
		device_types: manufacturerCounts.device_type_count,
		rack_types: manufacturerCounts.rack_type_count,
		devices: manufacturerCounts.device_count,
		past_eol: manufacturerCounts.past_eol_count,
	}
	return await pageRows(
		manufacturers,
		searchCondition(params.search, [manufacturers.name]),
		[orderOf(orderColumns[params.sort], params.order), asc(manufacturers.id)],
		params,
		manufacturerCounts,
	)
}

export function getManufacturer(id: number): Promise<Result<ManufacturerRow, Error>> {
	return findById(manufacturers, id, 'Manufacturer not found')
}

/** The manufacturer with its counts, for the detail page. */
export async function getManufacturerDetail(
	id: number,
): Promise<Result<ManufacturerListRow, Error>> {
	const [row] = await getDb()
		.select({ ...getTableColumns(manufacturers), ...manufacturerCounts })
		.from(manufacturers)
		.where(eq(manufacturers.id, id))
		.limit(1)
	return row ? Result.ok(row) : Result.err(new NotFoundError('Manufacturer not found'))
}

/** Name uniqueness guard; `excludeId` skips the row being updated. */
async function checkManufacturerUnique(
	name: string | undefined,
	excludeId?: number,
): Promise<Result<undefined, Error>> {
	if (
		name !== undefined &&
		(await isTaken(manufacturers, eq(manufacturers.name, name), excludeId))
	) {
		return Result.err(new DuplicateError(MANUFACTURER_NAME_IN_USE))
	}
	return Result.ok(undefined)
}

export async function createManufacturer(
	input: ManufacturerCreate,
): Promise<Result<ManufacturerRow, Error>> {
	const unique = await checkManufacturerUnique(input.name)
	if (Result.isError(unique)) {
		return unique
	}
	const row: Omit<ManufacturerRow, 'id'> = {
		name: input.name,
		description: input.description ?? null,
		website: input.website ?? null,
		support_url: input.support_url ?? null,
		comments: input.comments ?? null,
	}
	const id = await tryWrite(
		async () =>
			insertedId(
				await getDb().insert(manufacturers).values(row).returning({ id: manufacturers.id }),
			),
		MANUFACTURER_NAME_IN_USE,
	)
	if (Result.isError(id)) {
		return id
	}
	return await logCreate('manufacturer', await getManufacturer(id.value))
}

export async function updateManufacturer(
	id: number,
	input: ManufacturerUpdate,
): Promise<Result<ManufacturerRow, Error>> {
	const current = await getManufacturer(id)
	if (Result.isError(current)) {
		return current
	}
	const unique = await checkManufacturerUnique(input.name, id)
	if (Result.isError(unique)) {
		return unique
	}
	const patch = pickDefined(input, ['name', 'description', 'website', 'support_url', 'comments'])
	if (!isPatchEmpty(patch)) {
		const written = await tryWrite(
			() => getDb().update(manufacturers).set(patch).where(eq(manufacturers.id, id)),
			MANUFACTURER_NAME_IN_USE,
		)
		if (Result.isError(written)) {
			return written
		}
	}
	return await logUpdate('manufacturer', current.value, await getManufacturer(id))
}

export async function deleteManufacturer(id: number): Promise<Result<ManufacturerRow, Error>> {
	const current = await getManufacturer(id)
	if (Result.isError(current)) {
		return current
	}
	if (await exists(device_types, eq(device_types.manufacturer_id, id))) {
		return Result.err(
			new ConflictError('Manufacturer still has device types; move or delete them first'),
		)
	}
	if (await exists(rack_types, eq(rack_types.manufacturer_id, id))) {
		return Result.err(
			new ConflictError('Manufacturer still has rack types; move or delete them first'),
		)
	}
	const deleted = await tryWrite(() =>
		getDb().delete(manufacturers).where(eq(manufacturers.id, id)),
	)
	if (Result.isError(deleted)) {
		return deleted
	}
	return await logDelete('manufacturer', current.value)
}

// ---------------------------------------------------------------------------
// Device types
// ---------------------------------------------------------------------------

const DEVICE_TYPE_EXISTS = 'Device type already exists'

export interface DeviceTypeListParams extends ListParams {
	manufacturer?: number[]
	/** Default roles; a role also matches its child roles. */
	role?: number[]
	full_depth?: boolean
	/** EOL states; a type matches any of them. */
	eol?: DeviceTypeEolFilter[]
	sort: DeviceTypeListQuery['sort']
	order: 'asc' | 'desc'
}

/** Devices built from the outer device type row. */
const instanceCount = countWhere(devices.device_type_id, device_types.id)

export async function listDeviceTypes(
	params: DeviceTypeListParams,
): Promise<Page<DeviceTypeListRow>> {
	const roleIds = params.role ? await deviceRoleSubtrees(params.role) : undefined
	const eolConditions: Record<DeviceTypeEolFilter, SQL> = {
		past: lt(device_types.eol_date, sql`CURRENT_DATE`),
		announced: gte(device_types.eol_date, sql`CURRENT_DATE`),
		none: isNull(device_types.eol_date),
	}
	const where = and(
		params.search
			? or(
					searchCondition(params.search, [
						device_types.model,
						device_types.part_number,
						device_types.description,
					]),
					inArray(
						device_types.manufacturer_id,
						getDb()
							.select({ id: manufacturers.id })
							.from(manufacturers)
							.where(searchCondition(params.search, [manufacturers.name])),
					),
				)
			: undefined,
		params.manufacturer
			? inArray(device_types.manufacturer_id, params.manufacturer)
			: undefined,
		roleIds ? inArray(device_types.default_device_role_id, roleIds) : undefined,
		params.full_depth === undefined
			? undefined
			: eq(device_types.is_full_depth, params.full_depth),
		params.eol ? or(...params.eol.map((e) => eolConditions[e])) : undefined,
	)
	const orderColumns = {
		model: device_types.model,
		manufacturer: sql`(SELECT ${manufacturers.name} FROM ${manufacturers} WHERE ${manufacturers.id} = ${device_types.manufacturer_id})`,
		part_number: device_types.part_number,
		role: sql`(SELECT ${device_roles.name} FROM ${device_roles} WHERE ${device_roles.id} = ${device_types.default_device_role_id})`,
		description: device_types.description,
		comments: device_types.comments,
		u_height: device_types.u_height,
		is_full_depth: device_types.is_full_depth,
		spec_url: device_types.spec_url,
		eol_date: device_types.eol_date,
		devices: instanceCount,
	}
	return await pageRows(
		device_types,
		where,
		[orderOf(orderColumns[params.sort], params.order), asc(device_types.id)],
		params,
		{ instance_count: instanceCount },
	)
}

export function getDeviceType(id: number): Promise<Result<DeviceTypeRow, Error>> {
	return findById(device_types, id, 'Device type not found')
}

function checkManufacturerExists(id: number | undefined): Promise<Result<undefined, Error>> {
	return checkExists(manufacturers, id, 'Manufacturer not found')
}

function checkDefaultRoleExists(id: number | null | undefined): Promise<Result<undefined, Error>> {
	return checkExists(device_roles, id, 'Device role not found')
}

export async function createDeviceType(
	input: DeviceTypeCreate,
): Promise<Result<DeviceTypeRow, Error>> {
	const manufacturer = await checkManufacturerExists(input.manufacturer_id)
	if (Result.isError(manufacturer)) {
		return manufacturer
	}
	const role = await checkDefaultRoleExists(input.default_device_role_id)
	if (Result.isError(role)) {
		return role
	}
	const row: Omit<DeviceTypeRow, 'id'> = {
		manufacturer_id: input.manufacturer_id,
		model: input.model,
		u_height: input.u_height ?? 1,
		is_full_depth: input.is_full_depth ?? true,
		part_number: input.part_number || null,
		spec_url: input.spec_url ?? null,
		eol_date: input.eol_date ?? null,
		description: input.description ?? null,
		comments: input.comments ?? null,
		default_device_role_id: input.default_device_role_id ?? null,
	}
	const id = await tryWrite(
		async () =>
			insertedId(
				await getDb().insert(device_types).values(row).returning({ id: device_types.id }),
			),
		DEVICE_TYPE_EXISTS,
	)
	if (Result.isError(id)) {
		return id
	}
	return await logCreate('device_type', await getDeviceType(id.value))
}

/**
 * Re-runs bounds and overlap checks for every mounted device of a type with
 * a new height or depth (same loop `updateRack` uses for shrinks).
 */
async function checkMountedSize(
	type: DeviceTypeRow,
	uHeight: number,
	isFullDepth: boolean,
): Promise<Result<undefined, Error>> {
	const mounted = await getDb()
		.select()
		.from(devices)
		.where(and(eq(devices.device_type_id, type.id), isNotNull(devices.position_u)))
	for (const device of mounted) {
		if (device.rack_id === null || device.position_u === null) {
			continue
		}
		const rack = await findOne(racks, eq(racks.id, device.rack_id))
		if (!rack) {
			continue
		}
		const label = `Device "${device.name}"`
		const candidate = {
			id: device.id,
			name: device.name,
			position_u: device.position_u,
			height_u: uHeight,
			face: faceOf(device.face),
			is_full_depth: isFullDepth,
		}
		const bounds = checkBounds(candidate, await rackHeightOf(rack), label)
		if (Result.isError(bounds)) {
			return bounds
		}
		const overlap = checkOverlap(candidate, await rackSpansOf(device.rack_id), label, device.id)
		if (Result.isError(overlap)) {
			return overlap
		}
	}
	return Result.ok(undefined)
}

export async function updateDeviceType(
	id: number,
	input: DeviceTypeUpdate,
): Promise<Result<DeviceTypeRow, Error>> {
	const current = await getDeviceType(id)
	if (Result.isError(current)) {
		return current
	}
	const type = current.value
	const manufacturer = await checkManufacturerExists(input.manufacturer_id)
	if (Result.isError(manufacturer)) {
		return manufacturer
	}
	const role = await checkDefaultRoleExists(input.default_device_role_id)
	if (Result.isError(role)) {
		return role
	}
	const effectiveUHeight = input.u_height ?? type.u_height
	// Updating a type must not break devices that already exist.
	if (
		type.u_height >= 1 &&
		effectiveUHeight === 0 &&
		(await exists(devices, and(eq(devices.device_type_id, id), isNotNull(devices.position_u))))
	) {
		return Result.err(
			new ConflictError(
				'Gerätetyp hat noch eingebaute Geräte; Höhe kann nicht auf 0 gesetzt werden',
			),
		)
	}
	const effectiveFullDepth = input.is_full_depth ?? type.is_full_depth
	if (effectiveUHeight !== type.u_height || effectiveFullDepth !== type.is_full_depth) {
		const mounted = await checkMountedSize(type, effectiveUHeight, effectiveFullDepth)
		if (Result.isError(mounted)) {
			return mounted
		}
	}
	const patch: Partial<DeviceTypeRow> = pickDefined(input, [
		'manufacturer_id',
		'model',
		'u_height',
		'part_number',
		'spec_url',
		'eol_date',
		'description',
		'comments',
		'default_device_role_id',
	])
	if (input.is_full_depth !== undefined) {
		patch.is_full_depth = input.is_full_depth
	}
	if (!isPatchEmpty(patch)) {
		const written = await tryWrite(
			() => getDb().update(device_types).set(patch).where(eq(device_types.id, id)),
			DEVICE_TYPE_EXISTS,
		)
		if (Result.isError(written)) {
			return written
		}
	}
	return await logUpdate('device_type', type, await getDeviceType(id))
}

export async function deleteDeviceType(id: number): Promise<Result<DeviceTypeRow, Error>> {
	const current = await getDeviceType(id)
	if (Result.isError(current)) {
		return current
	}
	if (await exists(devices, eq(devices.device_type_id, id))) {
		return Result.err(
			new ConflictError('Device type still has devices; move or delete them first'),
		)
	}
	const deleted = await tryWrite(() =>
		getDb().transaction(async (tx) => {
			await tx
				.delete(device_type_interfaces)
				.where(eq(device_type_interfaces.device_type_id, id))
			await tx.delete(device_types).where(eq(device_types.id, id))
		}),
	)
	if (Result.isError(deleted)) {
		return deleted
	}
	return await logDelete('device_type', current.value)
}

// ---------------------------------------------------------------------------
// Stub rows
// ---------------------------------------------------------------------------

const STUB_EXISTS = 'This device type already has a stub with this prefix, kind and side'

/** Stub rows of a device type, in creation order (expansion follows it). */
export function stubsOf(deviceTypeId: number): Promise<StubRow[]> {
	return getDb()
		.select()
		.from(device_type_interfaces)
		.where(eq(device_type_interfaces.device_type_id, deviceTypeId))
		.orderBy(asc(device_type_interfaces.id))
}

export async function listStubs(deviceTypeId: number): Promise<Result<StubRow[], Error>> {
	const current = await getDeviceType(deviceTypeId)
	if (Result.isError(current)) {
		return current
	}
	const rows = await getDb()
		.select()
		.from(device_type_interfaces)
		.where(eq(device_type_interfaces.device_type_id, deviceTypeId))
		.orderBy(asc(device_type_interfaces.prefix), asc(device_type_interfaces.kind))
	return Result.ok(rows)
}

export function getStub(id: number): Promise<Result<StubRow, Error>> {
	return findById(device_type_interfaces, id, 'Interface stub not found')
}

/**
 * Rejects a candidate stub whose expansion collides with the sibling stubs
 * of the same device type. `excludeId` skips the row being updated.
 */
async function checkStubExpansion(
	deviceTypeId: number,
	candidate: StubInput,
	excludeId?: number,
): Promise<Result<undefined, Error>> {
	const powerError = stubPowerError(candidate)
	if (powerError !== null) {
		return Result.err(new ConflictError(powerError))
	}
	const siblings = (await stubsOf(deviceTypeId)).filter((s) => s.id !== excludeId)
	const expanded = expandStubs([...siblings, candidate])
	if (Result.isError(expanded)) {
		return Result.err(new ConflictError(expanded.error.message))
	}
	return Result.ok(undefined)
}

export async function createStub(
	deviceTypeId: number,
	input: StubCreate,
): Promise<Result<StubRow, Error>> {
	const current = await getDeviceType(deviceTypeId)
	if (Result.isError(current)) {
		return current
	}
	const row: Omit<StubRow, 'id'> = {
		device_type_id: deviceTypeId,
		prefix: input.prefix,
		count: input.count ?? 1,
		kind: input.kind ?? 'ethernet',
		description: input.description ?? null,
		side: input.side ?? null,
		positions: input.positions ?? 1,
		rear_stub_id: input.rear_stub_id ?? null,
		rear_position: input.rear_position ?? 1,
		maximum_draw: input.maximum_draw ?? null,
		poe_mode: input.poe_mode ?? null,
		poe_type: input.poe_type ?? null,
	}
	const clash = await checkStubExpansion(deviceTypeId, row)
	if (Result.isError(clash)) {
		return clash
	}
	const id = await tryWrite(
		async () =>
			insertedId(
				await getDb()
					.insert(device_type_interfaces)
					.values(row)
					.returning({ id: device_type_interfaces.id }),
			),
		STUB_EXISTS,
	)
	if (Result.isError(id)) {
		return id
	}
	return await logCreate('interface_template', await getStub(id.value))
}

export async function updateStub(id: number, input: StubUpdate): Promise<Result<StubRow, Error>> {
	const current = await getStub(id)
	if (Result.isError(current)) {
		return current
	}
	const side = current.value.side
	if (input.positions !== undefined && input.positions !== 1 && side !== 'rear') {
		return Result.err(new ConflictError('Positions are only allowed on rear ports'))
	}
	if (
		(input.rear_stub_id !== undefined || input.rear_position !== undefined) &&
		side !== 'front'
	) {
		return Result.err(new ConflictError('A rear port mapping is only allowed on front ports'))
	}
	const patch = pickDefined(input, [
		'prefix',
		'count',
		'kind',
		'description',
		'positions',
		'rear_stub_id',
		'rear_position',
		'maximum_draw',
		'poe_mode',
		'poe_type',
	])
	const clash = await checkStubExpansion(
		current.value.device_type_id,
		{ ...current.value, ...patch },
		id,
	)
	if (Result.isError(clash)) {
		return clash
	}
	if (!isPatchEmpty(patch)) {
		const written = await tryWrite(
			() =>
				getDb()
					.update(device_type_interfaces)
					.set(patch)
					.where(eq(device_type_interfaces.id, id)),
			STUB_EXISTS,
		)
		if (Result.isError(written)) {
			return written
		}
	}
	return await logUpdate('interface_template', current.value, await getStub(id))
}

export async function deleteStub(id: number): Promise<Result<StubRow, Error>> {
	const current = await getStub(id)
	if (Result.isError(current)) {
		return current
	}
	if (await exists(device_type_interfaces, eq(device_type_interfaces.rear_stub_id, id))) {
		return Result.err(
			new ConflictError('Front ports still map onto this rear port; delete them first'),
		)
	}
	const deleted = await tryWrite(() =>
		getDb().delete(device_type_interfaces).where(eq(device_type_interfaces.id, id)),
	)
	if (Result.isError(deleted)) {
		return deleted
	}
	return await logDelete('interface_template', current.value)
}
