import { Result } from 'better-result'
import { and, asc, count, desc, eq, isNotNull, isNull, type SQL, sql } from 'drizzle-orm'
import type {
	DeviceTypeCreate,
	DeviceTypeUpdate,
	ManufacturerCreate,
	ManufacturerUpdate,
	StubCreate,
	StubUpdate,
} from 'shared/src/schemas'
import { slugify } from 'shared/src/slug'
import { device_type_interfaces, device_types, devices, manufacturers, racks } from '../schema'
import { checkBounds, checkOverlap } from '../services/occupancy'
import { expandStubs } from '../services/templates'
import { getDb } from './connection'
import { ConflictError, DuplicateError, isUniqueViolation, NotFoundError } from './errors'
import type { ListParams, Page } from './list'
import { errOf, isPatchEmpty, offsetOf, pageOf, searchPattern } from './list'
import { deviceSpansOf, rackHeightOf } from './racks'

export type ManufacturerRow = typeof manufacturers.$inferSelect
export type DeviceTypeRow = typeof device_types.$inferSelect
export type StubRow = typeof device_type_interfaces.$inferSelect

// ---------------------------------------------------------------------------
// Manufacturers
// ---------------------------------------------------------------------------

export interface ManufacturerListParams extends ListParams {
	sort: 'name' | 'description'
	order: 'asc' | 'desc'
}

export function listManufacturers(params: ManufacturerListParams): Page<ManufacturerRow> {
	const db = getDb()
	const pattern = searchPattern(params.search)
	const where = params.search ? sql`${manufacturers.name} LIKE ${pattern} ESCAPE '\\'` : undefined
	const orderColumn =
		params.sort === 'description' ? manufacturers.description : manufacturers.name
	const items = db
		.select()
		.from(manufacturers)
		.where(where)
		.orderBy(params.order === 'desc' ? desc(orderColumn) : asc(orderColumn))
		.limit(params.limit)
		.offset(offsetOf(params))
		.all()
	const totalRow = db.select({ n: count() }).from(manufacturers).where(where).get()
	return pageOf(items, totalRow?.n ?? 0, params)
}

export function getManufacturer(id: number): Result<ManufacturerRow, Error> {
	const row = getDb().select().from(manufacturers).where(eq(manufacturers.id, id)).get()
	if (!row) {
		return Result.err(new NotFoundError('Manufacturer not found'))
	}
	return Result.ok(row)
}

export function createManufacturer(input: ManufacturerCreate): Result<ManufacturerRow, Error> {
	const db = getDb()
	const slug = input.slug ?? slugify(input.name)
	if (db.select().from(manufacturers).where(eq(manufacturers.slug, slug)).get()) {
		return Result.err(new DuplicateError('Manufacturer slug is already in use'))
	}
	if (db.select().from(manufacturers).where(eq(manufacturers.name, input.name)).get()) {
		return Result.err(new DuplicateError('Manufacturer name is already in use'))
	}
	const row: Omit<ManufacturerRow, 'id'> = {
		name: input.name,
		slug,
		description: input.description ?? null,
	}
	try {
		const inserted = db
			.insert(manufacturers)
			.values(row)
			.returning({ id: manufacturers.id })
			.get()
		if (!inserted) {
			return Result.err(new Error('Manufacturer insert did not return an id'))
		}
		return getManufacturer(inserted.id)
	} catch (err) {
		if (isUniqueViolation(err)) {
			return Result.err(new DuplicateError('Manufacturer slug or name is already in use'))
		}
		return Result.err(err instanceof Error ? err : new Error(String(err)))
	}
}

export function updateManufacturer(
	id: number,
	input: ManufacturerUpdate,
): Result<ManufacturerRow, Error> {
	const current = getManufacturer(id)
	if (Result.isError(current)) {
		return current
	}
	const db = getDb()
	if (input.slug !== undefined && input.slug !== current.value.slug) {
		if (db.select().from(manufacturers).where(eq(manufacturers.slug, input.slug)).get()) {
			return Result.err(new DuplicateError('Manufacturer slug is already in use'))
		}
	}
	if (input.name !== undefined && input.name !== current.value.name) {
		if (db.select().from(manufacturers).where(eq(manufacturers.name, input.name)).get()) {
			return Result.err(new DuplicateError('Manufacturer name is already in use'))
		}
	}
	const patch: Partial<ManufacturerRow> = {}
	if (input.name !== undefined) {
		patch.name = input.name
	}
	if (input.slug !== undefined) {
		patch.slug = input.slug
	}
	if (input.description !== undefined) {
		patch.description = input.description
	}
	if (!isPatchEmpty(patch)) {
		try {
			db.update(manufacturers).set(patch).where(eq(manufacturers.id, id)).run()
		} catch (err) {
			if (isUniqueViolation(err)) {
				return Result.err(new DuplicateError('Manufacturer slug or name is already in use'))
			}
			return Result.err(err instanceof Error ? err : new Error(String(err)))
		}
	}
	return getManufacturer(id)
}

export function deleteManufacturer(id: number): Result<ManufacturerRow, Error> {
	const current = getManufacturer(id)
	if (Result.isError(current)) {
		return current
	}
	const child = getDb()
		.select()
		.from(device_types)
		.where(eq(device_types.manufacturer_id, id))
		.get()
	if (child) {
		return Result.err(
			new ConflictError('Manufacturer still has device types; move or delete them first'),
		)
	}
	try {
		getDb().delete(manufacturers).where(eq(manufacturers.id, id)).run()
	} catch (e) {
		return Result.err(errOf(e))
	}
	return Result.ok(current.value)
}

// ---------------------------------------------------------------------------
// Device types
// ---------------------------------------------------------------------------

export interface DeviceTypeListParams extends ListParams {
	manufacturer?: number
	kind: 'device' | 'rack'
	sort: 'model'
	order: 'asc' | 'desc'
}

export function listDeviceTypes(params: DeviceTypeListParams): Page<DeviceTypeRow> {
	const db = getDb()
	const pattern = searchPattern(params.search)
	const conditions: SQL[] = []
	if (params.search) {
		conditions.push(
			params.kind === 'rack'
				? sql`${device_types.model} LIKE ${pattern} ESCAPE '\\'`
				: sql`${device_types.model} LIKE ${pattern} ESCAPE '\\'`,
		)
	}
	if (params.manufacturer) {
		conditions.push(eq(device_types.manufacturer_id, params.manufacturer))
	}
	// Rack types are the rows with rack-template dimensions; regular device
	// types deliberately have no form factor. Keep this filter in the query so
	// totals and pagination describe the selected catalog accurately.
	conditions.push(
		params.kind === 'rack'
			? isNotNull(device_types.form_factor)
			: isNull(device_types.form_factor),
	)
	const where = conditions.length > 0 ? and(...conditions) : undefined
	const orderColumn = device_types.model
	const items = db
		.select()
		.from(device_types)
		.where(where)
		.orderBy(params.order === 'desc' ? desc(orderColumn) : asc(orderColumn))
		.limit(params.limit)
		.offset(offsetOf(params))
		.all()
	const totalRow = db.select({ n: count() }).from(device_types).where(where).get()
	return pageOf(items, totalRow?.n ?? 0, params)
}

export function getDeviceType(id: number): Result<DeviceTypeRow, Error> {
	const row = getDb().select().from(device_types).where(eq(device_types.id, id)).get()
	if (!row) {
		return Result.err(new NotFoundError('Device type not found'))
	}
	return Result.ok(row)
}

export function createDeviceType(input: DeviceTypeCreate): Result<DeviceTypeRow, Error> {
	const db = getDb()
	if (!db.select().from(manufacturers).where(eq(manufacturers.id, input.manufacturer_id)).get()) {
		return Result.err(new NotFoundError('Manufacturer not found'))
	}
	const uHeight = input.u_height ?? 1
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
	try {
		const inserted = db
			.insert(device_types)
			.values(row)
			.returning({ id: device_types.id })
			.get()
		if (!inserted) {
			return Result.err(new Error('Device type insert did not return an id'))
		}
		return getDeviceType(inserted.id)
	} catch (err) {
		if (isUniqueViolation(err)) {
			return Result.err(new DuplicateError('Device type already exists'))
		}
		return Result.err(err instanceof Error ? err : new Error(String(err)))
	}
}

export function updateDeviceType(
	id: number,
	input: DeviceTypeUpdate,
): Result<DeviceTypeRow, Error> {
	const current = getDeviceType(id)
	if (Result.isError(current)) {
		return current
	}
	const db = getDb()
	if (input.manufacturer_id !== undefined) {
		if (
			!db
				.select()
				.from(manufacturers)
				.where(eq(manufacturers.id, input.manufacturer_id))
				.get()
		) {
			return Result.err(new NotFoundError('Manufacturer not found'))
		}
	}
	const patch: Partial<DeviceTypeRow> = {}
	if (input.manufacturer_id !== undefined) {
		patch.manufacturer_id = input.manufacturer_id
	}
	if (input.model !== undefined) {
		patch.model = input.model
	}
	const effectiveUHeight = input.u_height !== undefined ? input.u_height : current.value.u_height
	// Updating a type must not break devices that already exist.
	if (
		current.value.u_height >= 1 &&
		effectiveUHeight === 0 &&
		db
			.select()
			.from(devices)
			.where(and(eq(devices.device_type_id, id), isNotNull(devices.position_u)))
			.get()
	) {
		return Result.err(
			new ConflictError(
				'Gerätetyp hat noch eingebaute Geräte; Höhe kann nicht auf 0 gesetzt werden',
			),
		)
	}
	if (input.u_height !== undefined) {
		patch.u_height = input.u_height
	}
	// Changing the height re-runs bounds and overlap checks for every
	// mounted device of this type (same loop `updateRack` uses for shrinks).
	if (effectiveUHeight !== current.value.u_height) {
		const mounted = db
			.select()
			.from(devices)
			.where(and(eq(devices.device_type_id, id), isNotNull(devices.position_u)))
			.all()
		for (const mountedDevice of mounted) {
			if (mountedDevice.rack_id === null || mountedDevice.position_u === null) {
				continue
			}
			const rackRow = db.select().from(racks).where(eq(racks.id, mountedDevice.rack_id)).get()
			if (!rackRow) {
				continue
			}
			const candidate = {
				id: mountedDevice.id,
				name: mountedDevice.name,
				position_u: mountedDevice.position_u,
				height_u: effectiveUHeight,
				face:
					mountedDevice.face === 'front' || mountedDevice.face === 'rear'
						? mountedDevice.face
						: null,
				is_full_depth: current.value.is_full_depth !== 0,
			} as const
			const bounds = checkBounds(
				candidate,
				rackHeightOf(rackRow),
				`Device "${mountedDevice.name}"`,
			)
			if (Result.isError(bounds)) {
				return Result.err(bounds.error)
			}
			const overlap = checkOverlap(
				candidate,
				deviceSpansOf(mountedDevice.rack_id),
				`Device "${mountedDevice.name}"`,
				mountedDevice.id,
			)
			if (Result.isError(overlap)) {
				return Result.err(overlap.error)
			}
		}
	}
	if (input.is_full_depth !== undefined) {
		patch.is_full_depth = input.is_full_depth ? 1 : 0
	}
	if (input.form_factor !== undefined) {
		patch.form_factor = input.form_factor
	}
	const resultingFormFactor =
		input.form_factor !== undefined ? input.form_factor : current.value.form_factor
	if (resultingFormFactor !== null) {
		patch.width = 19
	} else if (input.width !== undefined) {
		patch.width = input.width
	}
	if (input.description !== undefined) {
		patch.description = input.description
	}
	if (input.comments !== undefined) {
		patch.comments = input.comments
	}
	if (!isPatchEmpty(patch)) {
		try {
			db.update(device_types).set(patch).where(eq(device_types.id, id)).run()
		} catch (err) {
			if (isUniqueViolation(err)) {
				return Result.err(new DuplicateError('Device type already exists'))
			}
			return Result.err(err instanceof Error ? err : new Error(String(err)))
		}
	}
	return getDeviceType(id)
}

export function deleteDeviceType(id: number): Result<DeviceTypeRow, Error> {
	const current = getDeviceType(id)
	if (Result.isError(current)) {
		return current
	}
	const device = getDb().select().from(devices).where(eq(devices.device_type_id, id)).get()
	if (device) {
		return Result.err(
			new ConflictError('Device type still has devices; move or delete them first'),
		)
	}
	try {
		getDb().transaction((tx) => {
			tx.delete(device_type_interfaces)
				.where(eq(device_type_interfaces.device_type_id, id))
				.run()
			tx.delete(device_types).where(eq(device_types.id, id)).run()
		})
	} catch (e) {
		return Result.err(errOf(e))
	}
	return Result.ok(current.value)
}

// ---------------------------------------------------------------------------
// Stub rows
// ---------------------------------------------------------------------------

export function listStubs(deviceTypeId: number): Result<StubRow[], Error> {
	const current = getDeviceType(deviceTypeId)
	if (Result.isError(current)) {
		return Result.err(current.error)
	}
	const rows = getDb()
		.select()
		.from(device_type_interfaces)
		.where(eq(device_type_interfaces.device_type_id, deviceTypeId))
		.orderBy(asc(device_type_interfaces.prefix), asc(device_type_interfaces.kind))
		.all()
	return Result.ok(rows)
}

export function getStub(id: number): Result<StubRow, Error> {
	const row = getDb()
		.select()
		.from(device_type_interfaces)
		.where(eq(device_type_interfaces.id, id))
		.get()
	if (!row) {
		return Result.err(new NotFoundError('Interface stub not found'))
	}
	return Result.ok(row)
}

/**
 * Rejects a candidate stub whose expansion collides with the sibling stubs
 * of the same device type. `excludeId` skips the row being updated.
 */
function checkStubExpansion(
	deviceTypeId: number,
	candidate: {
		prefix: string
		count: number
		kind: string
		label?: string | null
		description?: string | null
	},
	excludeId?: number,
): Result<undefined, Error> {
	const db = getDb()
	const siblings = db
		.select()
		.from(device_type_interfaces)
		.where(eq(device_type_interfaces.device_type_id, deviceTypeId))
		.all()
		.filter((s) => s.id !== excludeId)
	const expanded = expandStubs([
		...siblings.map((s) => ({
			prefix: s.prefix,
			count: s.count,
			kind: s.kind,
			label: s.label,
			description: s.description,
		})),
		candidate,
	])
	if (Result.isError(expanded)) {
		return Result.err(new ConflictError(expanded.error.message))
	}
	return Result.ok(undefined)
}

export function createStub(deviceTypeId: number, input: StubCreate): Result<StubRow, Error> {
	const current = getDeviceType(deviceTypeId)
	if (Result.isError(current)) {
		return Result.err(current.error)
	}
	const candidate = {
		prefix: input.prefix,
		count: input.count ?? 1,
		kind: input.kind ?? 'ethernet',
		label: input.label ?? null,
		description: input.description ?? null,
	}
	const clash = checkStubExpansion(deviceTypeId, candidate)
	if (Result.isError(clash)) {
		return Result.err(clash.error)
	}
	const row: Omit<StubRow, 'id'> = {
		device_type_id: deviceTypeId,
		prefix: candidate.prefix,
		count: candidate.count,
		kind: candidate.kind,
		label: candidate.label,
		description: candidate.description,
	}
	try {
		const inserted = getDb()
			.insert(device_type_interfaces)
			.values(row)
			.returning({ id: device_type_interfaces.id })
			.get()
		if (!inserted) {
			return Result.err(new Error('Stub insert did not return an id'))
		}
		return getStub(inserted.id)
	} catch (err) {
		if (isUniqueViolation(err)) {
			return Result.err(
				new DuplicateError('This device type already has a stub with this prefix and kind'),
			)
		}
		return Result.err(err instanceof Error ? err : new Error(String(err)))
	}
}

export function updateStub(id: number, input: StubUpdate): Result<StubRow, Error> {
	const current = getStub(id)
	if (Result.isError(current)) {
		return current
	}
	const node = current.value
	const candidate = {
		prefix: input.prefix ?? node.prefix,
		count: input.count ?? node.count,
		kind: input.kind ?? node.kind,
		label: input.label !== undefined ? input.label : node.label,
		description: input.description !== undefined ? input.description : node.description,
	}
	const clash = checkStubExpansion(node.device_type_id, candidate, id)
	if (Result.isError(clash)) {
		return Result.err(clash.error)
	}
	const patch: Partial<StubRow> = {}
	if (input.prefix !== undefined) {
		patch.prefix = input.prefix
	}
	if (input.count !== undefined) {
		patch.count = input.count
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
			getDb()
				.update(device_type_interfaces)
				.set(patch)
				.where(eq(device_type_interfaces.id, id))
				.run()
		} catch (err) {
			if (isUniqueViolation(err)) {
				return Result.err(
					new DuplicateError(
						'This device type already has a stub with this prefix and kind',
					),
				)
			}
			return Result.err(err instanceof Error ? err : new Error(String(err)))
		}
	}
	return getStub(id)
}

export function deleteStub(id: number): Result<StubRow, Error> {
	const current = getStub(id)
	if (Result.isError(current)) {
		return current
	}
	try {
		getDb().delete(device_type_interfaces).where(eq(device_type_interfaces.id, id)).run()
	} catch (e) {
		return Result.err(errOf(e))
	}
	return Result.ok(current.value)
}
