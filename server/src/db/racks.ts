import { Result } from 'better-result'
import { and, asc, count, desc, eq, type SQL, sql } from 'drizzle-orm'
import type {
	ElevationResponse,
	ElevationUnit,
	RackCreate,
	RackUpdate,
	ShelfCreate,
	ShelfUpdate,
} from 'shared/src/schemas'
import { device_types, devices, locations, rack_shelves, racks, sites, tenants } from '../schema'
import { checkBounds, checkOverlap, getOccupancy, type OccupantSpan } from '../services/occupancy'
import { getDb } from './connection'
import { ConflictError, DuplicateError, isUniqueViolation, NotFoundError } from './errors'
import type { ListParams, Page } from './tenancy'

type RackRecord = typeof racks.$inferSelect
/** Rack height is computed from the linked rack type, not stored on racks. */
export type RackRow = Omit<RackRecord, 'height_u'> & { height_u: number }
export type ShelfRow = typeof rack_shelves.$inferSelect

function withRackHeight(row: RackRecord): RackRow {
	const rackType =
		row.rack_type_id === null
			? undefined
			: getDb()
					.select({ u_height: device_types.u_height })
					.from(device_types)
					.where(eq(device_types.id, row.rack_type_id))
					.get()
	return { ...row, height_u: rackType?.u_height ?? 0 }
}

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

function shelfSpanOf(row: ShelfRow): OccupantSpan {
	return { id: row.id, name: row.name, position_u: row.position_u, height_u: row.height_u }
}

// ---------------------------------------------------------------------------
// Racks
// ---------------------------------------------------------------------------

export interface RackListParams extends ListParams {
	site?: number
	location?: number
	tenant?: number
	sort: 'name'
	order: 'asc' | 'desc'
	/** Tenant scope (own tenant only, strict); `undefined` = unconstrained. */
	scopeTenantId?: number
}

export function listRacks(params: RackListParams): Page<RackRow> {
	const db = getDb()
	const pattern = searchPattern(params.search)
	const conditions: SQL[] = []
	if (params.search) {
		conditions.push(
			sql`(${racks.name} LIKE ${pattern} ESCAPE '\\' OR ${racks.description} LIKE ${pattern} ESCAPE '\\')`,
		)
	}
	if (params.site) {
		conditions.push(eq(racks.site_id, params.site))
	}
	if (params.location) {
		conditions.push(eq(racks.location_id, params.location))
	}
	if (params.tenant) {
		conditions.push(eq(racks.tenant_id, params.tenant))
	}
	if (params.scopeTenantId !== undefined) {
		conditions.push(eq(racks.tenant_id, params.scopeTenantId))
	}
	const where = conditions.length > 0 ? and(...conditions) : undefined
	const items = db
		.select()
		.from(racks)
		.where(where)
		.orderBy(params.order === 'desc' ? desc(racks.name) : asc(racks.name))
		.limit(params.limit)
		.offset(offsetOf(params))
		.all()
		.map(withRackHeight)
	const totalRow = db.select({ n: count() }).from(racks).where(where).get()
	return pageOf(items, totalRow?.n ?? 0, params)
}

export function getRack(id: number): Result<RackRow, Error> {
	const row = getDb().select().from(racks).where(eq(racks.id, id)).get()
	if (!row) {
		return Result.err(new NotFoundError('Rack not found'))
	}
	return Result.ok(withRackHeight(row))
}

/**
 * Authoritative rack height in U, supplied by the rack type.
 */
export function rackHeightOf(rack: Pick<RackRecord, 'rack_type_id'>): number {
	if (rack.rack_type_id === null) {
		return 0
	}
	return (
		getDb()
			.select({ u_height: device_types.u_height })
			.from(device_types)
			.where(eq(device_types.id, rack.rack_type_id))
			.get()?.u_height ?? 0
	)
}

function checkTenant(tenantId: number | null | undefined): Result<undefined, Error> {
	if (tenantId === null || tenantId === undefined) {
		return Result.ok(undefined)
	}
	const tenant = getDb().select().from(tenants).where(eq(tenants.id, tenantId)).get()
	if (!tenant) {
		return Result.err(new NotFoundError('Tenant not found'))
	}
	return Result.ok(undefined)
}

/** Location must exist and belong to the rack's site; null clears the link. */
function checkLocation(
	locationId: number | null | undefined,
	siteId: number,
): Result<undefined, Error> {
	if (locationId === null || locationId === undefined) {
		return Result.ok(undefined)
	}
	const location = getDb().select().from(locations).where(eq(locations.id, locationId)).get()
	if (!location || location.site_id !== siteId) {
		return Result.err(new NotFoundError('Location not found in this site'))
	}
	return Result.ok(undefined)
}

/** Shelves of one rack, bottom-up. */
function shelvesOf(rackId: number): ShelfRow[] {
	return getDb()
		.select()
		.from(rack_shelves)
		.where(eq(rack_shelves.rack_id, rackId))
		.orderBy(asc(rack_shelves.position_u))
		.all()
}

/**
 * U-consuming device spans of one rack (position-mounted only; shelf-sitters
 * consume 0 U). Joins the template for `u_height`, the footprint each span
 * occupies. Exported so `db/devices.ts` validates mounts against the same
 * rows the elevation renders.
 */
export function deviceSpansOf(rackId: number): OccupantSpan[] {
	return deviceDetailsOf(rackId).map((d) => ({
		id: d.id,
		name: d.name,
		position_u: d.position_u,
		height_u: d.u_height,
	}))
}

/** Full device mount details behind each span, for the enriched elevation. */
export function deviceDetailsOf(rackId: number): {
	id: number
	name: string
	position_u: number
	u_height: number
	face: 'front' | 'rear' | null
	status: string
	device_type_id: number
	device_type_model: string
	is_full_depth: boolean
}[] {
	const rows = getDb()
		.select({
			id: devices.id,
			name: devices.name,
			position_u: devices.position_u,
			face: devices.face,
			status: devices.status,
			device_type_id: devices.device_type_id,
			device_type_model: device_types.model,
			u_height: device_types.u_height,
			is_full_depth: device_types.is_full_depth,
		})
		.from(devices)
		.innerJoin(device_types, eq(devices.device_type_id, device_types.id))
		.where(eq(devices.rack_id, rackId))
		.orderBy(asc(devices.position_u))
		.all()
	const details: {
		id: number
		name: string
		position_u: number
		u_height: number
		face: 'front' | 'rear' | null
		status: string
		device_type_id: number
		device_type_model: string
		is_full_depth: boolean
	}[] = []
	for (const row of rows) {
		if (row.position_u === null) {
			continue
		}
		details.push({
			id: row.id,
			name: row.name,
			position_u: row.position_u,
			u_height: row.u_height,
			face: row.face === 'front' || row.face === 'rear' ? row.face : null,
			status: row.status,
			device_type_id: row.device_type_id,
			device_type_model: row.device_type_model,
			is_full_depth: row.is_full_depth !== 0,
		})
	}
	return details
}

/** Every U-consuming span of a rack: shelves plus position-mounted devices. */
function allSpansOf(rackId: number): OccupantSpan[] {
	return [...shelvesOf(rackId).map(shelfSpanOf), ...deviceSpansOf(rackId)]
}

export function createRack(input: RackCreate): Result<RackRow, Error> {
	const db = getDb()
	const site = db.select().from(sites).where(eq(sites.id, input.site_id)).get()
	if (!site) {
		return Result.err(new NotFoundError('Site not found'))
	}
	const rackType = db
		.select()
		.from(device_types)
		.where(eq(device_types.id, input.rack_type_id))
		.get()
	if (!rackType || rackType.form_factor === null) {
		return Result.err(new NotFoundError('Rack type not found'))
	}
	const tenantCheck = checkTenant(input.tenant_id)
	if (Result.isError(tenantCheck)) {
		return Result.err(tenantCheck.error)
	}
	const locationCheck = checkLocation(input.location_id, input.site_id)
	if (Result.isError(locationCheck)) {
		return Result.err(locationCheck.error)
	}
	const row: Omit<RackRecord, 'id'> = {
		site_id: input.site_id,
		location_id: input.location_id ?? null,
		tenant_id: input.tenant_id ?? null,
		rack_type_id: input.rack_type_id,
		name: input.name,
		description: input.description ?? null,
	}
	try {
		const inserted = db.insert(racks).values(row).returning({ id: racks.id }).get()
		if (!inserted) {
			return Result.err(new Error('Rack insert did not return an id'))
		}
		return getRack(inserted.id)
	} catch (err) {
		if (isUniqueViolation(err)) {
			return Result.err(new DuplicateError('Rack name is already in use'))
		}
		return Result.err(err instanceof Error ? err : new Error(String(err)))
	}
}

export function updateRack(id: number, input: RackUpdate): Result<RackRow, Error> {
	const current = getRack(id)
	if (Result.isError(current)) {
		return current
	}
	const node = current.value
	if (input.tenant_id !== undefined) {
		const tenantCheck = checkTenant(input.tenant_id)
		if (Result.isError(tenantCheck)) {
			return Result.err(tenantCheck.error)
		}
	}
	if (input.location_id !== undefined) {
		const locationCheck = checkLocation(input.location_id, node.site_id)
		if (Result.isError(locationCheck)) {
			return Result.err(locationCheck.error)
		}
	}
	const db = getDb()
	let newTypeHeight: number | null = null
	if (input.rack_type_id !== undefined) {
		const rackType = db
			.select()
			.from(device_types)
			.where(eq(device_types.id, input.rack_type_id))
			.get()
		if (!rackType || rackType.form_factor === null) {
			return Result.err(new NotFoundError('Rack type not found'))
		}
		newTypeHeight = rackType.u_height
	}
	const storedHeight = rackHeightOf(node)
	const effectiveHeight = newTypeHeight ?? storedHeight
	if (effectiveHeight !== storedHeight) {
		// Shrinking below the topmost occupied U would strand shelves or
		// devices outside the rack; reject with the same bounds error
		// creation uses.
		for (const shelf of shelvesOf(id)) {
			const bounds = checkBounds(shelfSpanOf(shelf), effectiveHeight, `Shelf "${shelf.name}"`)
			if (Result.isError(bounds)) {
				return Result.err(bounds.error)
			}
		}
		for (const device of deviceSpansOf(id)) {
			const bounds = checkBounds(device, effectiveHeight, `Device "${device.name}"`)
			if (Result.isError(bounds)) {
				return Result.err(bounds.error)
			}
		}
	}
	const patch: Partial<RackRow> = {}
	if (input.name !== undefined) {
		patch.name = input.name
	}
	if (input.rack_type_id !== undefined) {
		patch.rack_type_id = input.rack_type_id
	}
	if (input.location_id !== undefined) {
		patch.location_id = input.location_id
	}
	if (input.tenant_id !== undefined) {
		patch.tenant_id = input.tenant_id
	}
	if (input.description !== undefined) {
		patch.description = input.description
	}
	if (Object.keys(patch).length > 0) {
		try {
			db.update(racks).set(patch).where(eq(racks.id, id)).run()
		} catch (err) {
			if (isUniqueViolation(err)) {
				return Result.err(new DuplicateError('Rack name is already in use'))
			}
			return Result.err(err instanceof Error ? err : new Error(String(err)))
		}
	}
	return getRack(id)
}

export function deleteRack(id: number): Result<RackRow, Error> {
	const current = getRack(id)
	if (Result.isError(current)) {
		return current
	}
	const shelf = getDb().select().from(rack_shelves).where(eq(rack_shelves.rack_id, id)).get()
	if (shelf) {
		return Result.err(new ConflictError('Rack still has shelves; delete them first'))
	}
	const device = getDb().select().from(devices).where(eq(devices.rack_id, id)).get()
	if (device) {
		return Result.err(new ConflictError('Rack still has devices; move or delete them first'))
	}
	getDb().delete(racks).where(eq(racks.id, id)).run()
	return Result.ok(current.value)
}

/** Ordered U map of a rack, top-down (highest U first), shelves plus devices. */
export function getElevation(id: number): Result<ElevationResponse, Error> {
	const current = getRack(id)
	if (Result.isError(current)) {
		return current
	}
	const rack = current.value
	const heightU = rackHeightOf(rack)
	const shelves = shelvesOf(id)
	const details = deviceDetailsOf(id)
	const occupancy = getOccupancy(
		heightU,
		shelves.map(shelfSpanOf),
		details.map((d) => ({
			id: d.id,
			name: d.name,
			position_u: d.position_u,
			height_u: d.u_height,
		})),
	)
	if (Result.isError(occupancy)) {
		return Result.err(occupancy.error)
	}
	const shelfById = new Map(shelves.map((s) => [s.id, s]))
	const deviceById = new Map(details.map((d) => [d.id, d]))
	const units: ElevationUnit[] = [...occupancy.value.units].reverse().map((u) => {
		const shelfId = u.shelf?.id ?? null
		const shelfRow = shelfId !== null ? shelfById.get(shelfId) : undefined
		const deviceId = u.device?.id ?? null
		const deviceRow = deviceId !== null ? deviceById.get(deviceId) : undefined
		return {
			u: u.u,
			shelf:
				shelfRow === undefined
					? null
					: {
							id: shelfRow.id,
							name: shelfRow.name,
							position_u: shelfRow.position_u,
							height_u: shelfRow.height_u,
						},
			device:
				deviceRow === undefined
					? null
					: {
							id: deviceRow.id,
							name: deviceRow.name,
							face: deviceRow.face,
							position_u: deviceRow.position_u,
							u_height: deviceRow.u_height,
							status: deviceRow.status,
							device_type_id: deviceRow.device_type_id,
							device_type_model: deviceRow.device_type_model,
							is_full_depth: deviceRow.is_full_depth,
						},
		}
	})
	return Result.ok({ rack_id: rack.id, height_u: heightU, units })
}

// ---------------------------------------------------------------------------
// Shelves
// ---------------------------------------------------------------------------

export interface ShelfListParams extends ListParams {
	rack?: number
	/**
	 * Tenant scope for scoped editors/viewers: restricts the list to shelves
	 * whose rack sits in the scope tenant (strict — shared racks excluded).
	 * `undefined` means unconstrained.
	 */
	scopeTenantId?: number
}

export function listShelves(params: ShelfListParams): Page<ShelfRow> {
	const db = getDb()
	const pattern = searchPattern(params.search)
	const conditions: SQL[] = []
	if (params.search) {
		conditions.push(sql`(${rack_shelves.name} LIKE ${pattern} ESCAPE '\\')`)
	}
	if (params.rack) {
		conditions.push(eq(rack_shelves.rack_id, params.rack))
	}
	if (params.scopeTenantId !== undefined) {
		conditions.push(
			sql`EXISTS (SELECT 1 FROM ${racks} AS scope_rack WHERE scope_rack.id = ${rack_shelves.rack_id} AND scope_rack.tenant_id = ${params.scopeTenantId})`,
		)
	}
	const where = conditions.length > 0 ? and(...conditions) : undefined
	const items = db
		.select()
		.from(rack_shelves)
		.where(where)
		.orderBy(asc(rack_shelves.position_u))
		.limit(params.limit)
		.offset(offsetOf(params))
		.all()
	const totalRow = db.select({ n: count() }).from(rack_shelves).where(where).get()
	return pageOf(items, totalRow?.n ?? 0, params)
}

export function getShelf(id: number): Result<ShelfRow, Error> {
	const row = getDb().select().from(rack_shelves).where(eq(rack_shelves.id, id)).get()
	if (!row) {
		return Result.err(new NotFoundError('Shelf not found'))
	}
	return Result.ok(row)
}

export function createShelf(input: ShelfCreate): Result<ShelfRow, Error> {
	const rack = getRack(input.rack_id)
	if (Result.isError(rack)) {
		return Result.err(rack.error)
	}
	const candidate: OccupantSpan = {
		id: 0,
		name: input.name,
		position_u: input.position_u,
		height_u: input.height_u ?? 1,
	}
	const bounds = checkBounds(candidate, rackHeightOf(rack.value), `Shelf "${input.name}"`)
	if (Result.isError(bounds)) {
		return Result.err(bounds.error)
	}
	const siblings = allSpansOf(input.rack_id)
	const overlap = checkOverlap(candidate, siblings, `Shelf "${input.name}"`)
	if (Result.isError(overlap)) {
		return Result.err(overlap.error)
	}
	const row: Omit<ShelfRow, 'id'> = {
		rack_id: input.rack_id,
		name: input.name,
		position_u: input.position_u,
		height_u: input.height_u ?? 1,
		capacity_slots: input.capacity_slots ?? null,
	}
	try {
		const inserted = getDb()
			.insert(rack_shelves)
			.values(row)
			.returning({ id: rack_shelves.id })
			.get()
		if (!inserted) {
			return Result.err(new Error('Shelf insert did not return an id'))
		}
		return getShelf(inserted.id)
	} catch (err) {
		return Result.err(err instanceof Error ? err : new Error(String(err)))
	}
}

export function updateShelf(id: number, input: ShelfUpdate): Result<ShelfRow, Error> {
	const current = getShelf(id)
	if (Result.isError(current)) {
		return current
	}
	const node = current.value
	const rack = getRack(node.rack_id)
	if (Result.isError(rack)) {
		return Result.err(rack.error)
	}
	const effectiveName = input.name ?? node.name
	const effective: OccupantSpan = {
		id,
		name: effectiveName,
		position_u: input.position_u ?? node.position_u,
		height_u: input.height_u ?? node.height_u,
	}
	const bounds = checkBounds(effective, rackHeightOf(rack.value), `Shelf "${effectiveName}"`)
	if (Result.isError(bounds)) {
		return Result.err(bounds.error)
	}
	const siblings = allSpansOf(node.rack_id)
	const overlap = checkOverlap(effective, siblings, `Shelf "${effectiveName}"`, id)
	if (Result.isError(overlap)) {
		return Result.err(overlap.error)
	}
	const patch: Partial<ShelfRow> = {}
	if (input.name !== undefined) {
		patch.name = input.name
	}
	if (input.position_u !== undefined) {
		patch.position_u = input.position_u
	}
	if (input.height_u !== undefined) {
		patch.height_u = input.height_u
	}
	if (input.capacity_slots !== undefined) {
		patch.capacity_slots = input.capacity_slots
	}
	if (Object.keys(patch).length > 0) {
		getDb().update(rack_shelves).set(patch).where(eq(rack_shelves.id, id)).run()
	}
	return getShelf(id)
}

export function deleteShelf(id: number): Result<ShelfRow, Error> {
	const current = getShelf(id)
	if (Result.isError(current)) {
		return current
	}
	const sitter = getDb().select().from(devices).where(eq(devices.shelf_id, id)).get()
	if (sitter) {
		return Result.err(new ConflictError('Shelf still has devices; move or delete them first'))
	}
	getDb().delete(rack_shelves).where(eq(rack_shelves.id, id)).run()
	return Result.ok(current.value)
}
