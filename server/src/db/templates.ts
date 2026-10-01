import { Result } from 'better-result'
import { and, asc, eq, isNotNull, isNull, sql } from 'drizzle-orm'
import type {
	ChangeObjectType,
	DeviceTypeCreate,
	DeviceTypeUpdate,
	ManufacturerCreate,
	ManufacturerUpdate,
	StubCreate,
	StubUpdate,
} from 'shared/src/schemas'
import { slugify } from 'shared/src/slug'
import { device_type_interfaces, device_types, devices, manufacturers, racks } from '../schema'
import { checkBounds, checkOverlap, faceOf } from '../services/occupancy'
import { expandStubs, type StubInput } from '../services/templates'
import { logCreate, logDelete, logUpdate } from './changelog'
import { getDb } from './connection'
import { ConflictError, DuplicateError } from './errors'
import type { ListParams, Page } from './list'
import {
	checkExists,
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
	tryWrite,
} from './list'
import { deviceSpansOf, rackHeightOf } from './racks'

export type ManufacturerRow = typeof manufacturers.$inferSelect
export type DeviceTypeRow = typeof device_types.$inferSelect
export type StubRow = typeof device_type_interfaces.$inferSelect

/** Rack types share the device type table; a form factor marks them. */
function typeKindOf(row: DeviceTypeRow): ChangeObjectType {
	return row.form_factor === null ? 'device_type' : 'rack_type'
}

// ---------------------------------------------------------------------------
// Manufacturers
// ---------------------------------------------------------------------------

const MANUFACTURER_SLUG_IN_USE = 'Manufacturer slug is already in use'
const MANUFACTURER_NAME_IN_USE = 'Manufacturer name is already in use'
const MANUFACTURER_IN_USE = 'Manufacturer slug or name is already in use'

export interface ManufacturerListParams extends ListParams {
	sort: 'name' | 'description'
	order: 'asc' | 'desc'
}

export function listManufacturers(params: ManufacturerListParams): Promise<Page<ManufacturerRow>> {
	const orderColumn =
		params.sort === 'description' ? manufacturers.description : manufacturers.name
	return pageRows(
		manufacturers,
		searchCondition(params.search, [manufacturers.name]),
		[orderOf(orderColumn, params.order), asc(manufacturers.id)],
		params,
	)
}

export function getManufacturer(id: number): Promise<Result<ManufacturerRow, Error>> {
	return findById(manufacturers, id, 'Manufacturer not found')
}

/** Slug/name uniqueness guard; `excludeId` skips the row being updated. */
async function checkManufacturerUnique(
	slug: string | undefined,
	name: string | undefined,
	excludeId?: number,
): Promise<Result<undefined, Error>> {
	if (
		slug !== undefined &&
		(await isTaken(manufacturers, eq(manufacturers.slug, slug), excludeId))
	) {
		return Result.err(new DuplicateError(MANUFACTURER_SLUG_IN_USE))
	}
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
	const slug = input.slug ?? slugify(input.name)
	const unique = await checkManufacturerUnique(slug, input.name)
	if (Result.isError(unique)) {
		return unique
	}
	const row: Omit<ManufacturerRow, 'id'> = {
		name: input.name,
		slug,
		description: input.description ?? null,
	}
	const id = await tryWrite(
		async () =>
			insertedId(
				await getDb().insert(manufacturers).values(row).returning({ id: manufacturers.id }),
			),
		MANUFACTURER_IN_USE,
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
	const unique = await checkManufacturerUnique(input.slug, input.name, id)
	if (Result.isError(unique)) {
		return unique
	}
	const patch = pickDefined(input, ['name', 'slug', 'description'])
	if (!isPatchEmpty(patch)) {
		const written = await tryWrite(
			() => getDb().update(manufacturers).set(patch).where(eq(manufacturers.id, id)),
			MANUFACTURER_IN_USE,
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
	manufacturer?: number
	kind: 'device' | 'rack'
	sort: 'model' | 'manufacturer' | 'form_factor'
	order: 'asc' | 'desc'
}

export function listDeviceTypes(params: DeviceTypeListParams): Promise<Page<DeviceTypeRow>> {
	const where = and(
		searchCondition(params.search, [device_types.model]),
		params.manufacturer ? eq(device_types.manufacturer_id, params.manufacturer) : undefined,
		// Rack types are the rows with rack-template dimensions; regular device
		// types deliberately have no form factor. Keep this filter in the query so
		// totals and pagination describe the selected catalog accurately.
		params.kind === 'rack'
			? isNotNull(device_types.form_factor)
			: isNull(device_types.form_factor),
	)
	const orderColumn =
		params.sort === 'manufacturer'
			? sql`(SELECT ${manufacturers.name} FROM ${manufacturers} WHERE ${manufacturers.id} = ${device_types.manufacturer_id})`
			: params.sort === 'form_factor' && params.kind === 'rack'
				? device_types.form_factor
				: device_types.model
	return pageRows(
		device_types,
		where,
		[orderOf(orderColumn, params.order), asc(device_types.id)],
		params,
	)
}

export function getDeviceType(id: number): Promise<Result<DeviceTypeRow, Error>> {
	return findById(device_types, id, 'Device type not found')
}

function checkManufacturerExists(id: number | undefined): Promise<Result<undefined, Error>> {
	return checkExists(manufacturers, id, 'Manufacturer not found')
}

export async function createDeviceType(
	input: DeviceTypeCreate,
): Promise<Result<DeviceTypeRow, Error>> {
	const manufacturer = await checkManufacturerExists(input.manufacturer_id)
	if (Result.isError(manufacturer)) {
		return manufacturer
	}
	const uHeight = input.u_height ?? 1
	if (input.form_factor !== undefined && uHeight < 1) {
		return Result.err(new ConflictError('Rack type must have a height of at least 1 U'))
	}
	const row: Omit<DeviceTypeRow, 'id'> = {
		manufacturer_id: input.manufacturer_id,
		model: input.model,
		u_height: uHeight,
		is_full_depth: (input.is_full_depth ?? true) ? 1 : 0,
		form_factor: input.form_factor ?? null,
		// Rack types use the standard 19-inch mounting width. Keep the generic
		// device-type API's other width options for non-rack device types.
		width: input.form_factor !== undefined ? 19 : (input.width ?? null),
		description: input.description ?? null,
		comments: input.comments ?? null,
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
	return await logCreate(typeKindOf, await getDeviceType(id.value))
}

/**
 * Re-runs bounds and overlap checks for every mounted device of a type with
 * a new height (same loop `updateRack` uses for shrinks).
 */
async function checkMountedHeight(
	type: DeviceTypeRow,
	uHeight: number,
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
			is_full_depth: type.is_full_depth !== 0,
		}
		const bounds = checkBounds(candidate, await rackHeightOf(rack), label)
		if (Result.isError(bounds)) {
			return bounds
		}
		const overlap = checkOverlap(
			candidate,
			await deviceSpansOf(device.rack_id),
			label,
			device.id,
		)
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
	const effectiveUHeight = input.u_height ?? type.u_height
	const effectiveFormFactor =
		input.form_factor !== undefined ? input.form_factor : type.form_factor
	if (effectiveFormFactor !== null && effectiveUHeight < 1) {
		return Result.err(new ConflictError('Rack type must have a height of at least 1 U'))
	}
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
	if (effectiveUHeight !== type.u_height) {
		const mounted = await checkMountedHeight(type, effectiveUHeight)
		if (Result.isError(mounted)) {
			return mounted
		}
	}
	const patch: Partial<DeviceTypeRow> = pickDefined(input, [
		'manufacturer_id',
		'model',
		'u_height',
		'form_factor',
		'description',
		'comments',
	])
	if (input.is_full_depth !== undefined) {
		patch.is_full_depth = input.is_full_depth ? 1 : 0
	}
	if (effectiveFormFactor !== null) {
		patch.width = 19
	} else if (input.width !== undefined) {
		patch.width = input.width
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
	return await logUpdate(typeKindOf, type, await getDeviceType(id))
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
	return await logDelete(typeKindOf, current.value)
}

// ---------------------------------------------------------------------------
// Stub rows
// ---------------------------------------------------------------------------

const STUB_EXISTS = 'This device type already has a stub with this prefix and kind'

/** Stub rows of a device type, in no particular order. */
export function stubsOf(deviceTypeId: number): Promise<StubRow[]> {
	return getDb()
		.select()
		.from(device_type_interfaces)
		.where(eq(device_type_interfaces.device_type_id, deviceTypeId))
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
		label: input.label ?? null,
		description: input.description ?? null,
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
	const patch = pickDefined(input, ['prefix', 'count', 'kind', 'label', 'description'])
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
	const deleted = await tryWrite(() =>
		getDb().delete(device_type_interfaces).where(eq(device_type_interfaces.id, id)),
	)
	if (Result.isError(deleted)) {
		return deleted
	}
	return await logDelete('interface_template', current.value)
}
