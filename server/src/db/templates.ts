import { Result } from 'better-result'
import { and, asc, count, desc, eq, type SQL, sql } from 'drizzle-orm'
import type {
	DeviceTypeCreate,
	DeviceTypeUpdate,
	ExpandedInterface,
	ManufacturerCreate,
	ManufacturerUpdate,
	StubCreate,
	StubPreviewResponse,
	StubUpdate,
} from 'shared/src/schemas'
import { device_type_interfaces, device_types, devices, manufacturers } from '../schema'
import { expandStub, expandStubs } from '../services/templates'
import { getDb } from './connection'
import { ConflictError, DuplicateError, isUniqueViolation, NotFoundError } from './errors'
import type { ListParams, Page } from './tenancy'

export type ManufacturerRow = typeof manufacturers.$inferSelect
export type DeviceTypeRow = typeof device_types.$inferSelect
export type StubRow = typeof device_type_interfaces.$inferSelect

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
// Manufacturers
// ---------------------------------------------------------------------------

export interface ManufacturerListParams extends ListParams {
	sort: 'name' | 'slug' | 'description'
	order: 'asc' | 'desc'
}

export function listManufacturers(params: ManufacturerListParams): Page<ManufacturerRow> {
	const db = getDb()
	const pattern = searchPattern(params.search)
	const where = params.search
		? sql`(${manufacturers.name} LIKE ${pattern} ESCAPE '\\' OR ${manufacturers.slug} LIKE ${pattern} ESCAPE '\\')`
		: undefined
	const orderColumn =
		params.sort === 'slug'
			? manufacturers.slug
			: params.sort === 'description'
				? manufacturers.description
				: manufacturers.name
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
	if (db.select().from(manufacturers).where(eq(manufacturers.slug, input.slug)).get()) {
		return Result.err(new DuplicateError('Manufacturer slug is already in use'))
	}
	if (db.select().from(manufacturers).where(eq(manufacturers.name, input.name)).get()) {
		return Result.err(new DuplicateError('Manufacturer name is already in use'))
	}
	const row: Omit<ManufacturerRow, 'id'> = {
		name: input.name,
		slug: input.slug,
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
	if (Object.keys(patch).length > 0) {
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
	getDb().delete(manufacturers).where(eq(manufacturers.id, id)).run()
	return Result.ok(current.value)
}

// ---------------------------------------------------------------------------
// Device types
// ---------------------------------------------------------------------------

export interface DeviceTypeListParams extends ListParams {
	manufacturer?: number
	sort: 'model' | 'slug'
	order: 'asc' | 'desc'
}

export function listDeviceTypes(params: DeviceTypeListParams): Page<DeviceTypeRow> {
	const db = getDb()
	const pattern = searchPattern(params.search)
	const conditions: SQL[] = []
	if (params.search) {
		conditions.push(
			sql`(${device_types.model} LIKE ${pattern} ESCAPE '\\' OR ${device_types.slug} LIKE ${pattern} ESCAPE '\\')`,
		)
	}
	if (params.manufacturer) {
		conditions.push(eq(device_types.manufacturer_id, params.manufacturer))
	}
	const where = conditions.length > 0 ? and(...conditions) : undefined
	const orderColumn = params.sort === 'slug' ? device_types.slug : device_types.model
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
	if (db.select().from(device_types).where(eq(device_types.slug, input.slug)).get()) {
		return Result.err(new DuplicateError('Device type slug is already in use'))
	}
	const row: Omit<DeviceTypeRow, 'id'> = {
		manufacturer_id: input.manufacturer_id,
		model: input.model,
		slug: input.slug,
		u_height: input.u_height ?? 1,
		is_full_depth: (input.is_full_depth ?? true) ? 1 : 0,
		form_factor: input.form_factor ?? null,
		width: input.width ?? null,
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
			return Result.err(new DuplicateError('Device type slug is already in use'))
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
	if (input.slug !== undefined && input.slug !== current.value.slug) {
		if (db.select().from(device_types).where(eq(device_types.slug, input.slug)).get()) {
			return Result.err(new DuplicateError('Device type slug is already in use'))
		}
	}
	const patch: Partial<DeviceTypeRow> = {}
	if (input.manufacturer_id !== undefined) {
		patch.manufacturer_id = input.manufacturer_id
	}
	if (input.model !== undefined) {
		patch.model = input.model
	}
	if (input.slug !== undefined) {
		patch.slug = input.slug
	}
	if (input.u_height !== undefined) {
		patch.u_height = input.u_height
	}
	if (input.is_full_depth !== undefined) {
		patch.is_full_depth = input.is_full_depth ? 1 : 0
	}
	if (input.form_factor !== undefined) {
		patch.form_factor = input.form_factor
	}
	if (input.width !== undefined) {
		patch.width = input.width
	}
	if (input.description !== undefined) {
		patch.description = input.description
	}
	if (input.comments !== undefined) {
		patch.comments = input.comments
	}
	if (Object.keys(patch).length > 0) {
		try {
			db.update(device_types).set(patch).where(eq(device_types.id, id)).run()
		} catch (err) {
			if (isUniqueViolation(err)) {
				return Result.err(new DuplicateError('Device type slug is already in use'))
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
	const db = getDb()
	db.delete(device_type_interfaces).where(eq(device_type_interfaces.device_type_id, id)).run()
	db.delete(device_types).where(eq(device_types.id, id)).run()
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
	candidate: { prefix: string; count: number; kind: string; label?: string | null },
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
	if (Object.keys(patch).length > 0) {
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
	getDb().delete(device_type_interfaces).where(eq(device_type_interfaces.id, id)).run()
	return Result.ok(current.value)
}

// ---------------------------------------------------------------------------
// Preview expansion
// ---------------------------------------------------------------------------

/** Expands the stored stubs of a device type into concrete interface names. */
export function previewDeviceType(id: number): Result<StubPreviewResponse, Error> {
	const stubs = listStubs(id)
	if (Result.isError(stubs)) {
		return Result.err(stubs.error)
	}
	const expanded = expandStubs(
		stubs.value.map((s) => ({
			prefix: s.prefix,
			count: s.count,
			kind: s.kind,
			label: s.label,
		})),
	)
	if (Result.isError(expanded)) {
		return Result.err(new ConflictError(expanded.error.message))
	}
	return Result.ok({ interfaces: expanded.value, total: expanded.value.length })
}

/** Expands one ad-hoc stub (`?prefix=&count=&kind=`) without storing it. */
export function previewStub(
	prefix: string,
	stubCount: number,
	kind: string,
): Result<StubPreviewResponse, Error> {
	const names = expandStub(prefix, stubCount)
	if (Result.isError(names)) {
		return Result.err(new ConflictError(names.error.message))
	}
	const interfaces: ExpandedInterface[] = names.value.map((name) => ({
		name,
		kind,
		label: null,
	}))
	return Result.ok({ interfaces, total: interfaces.length })
}
