import { Result } from 'better-result'
import { and, asc, count, eq, type SQL, sql } from 'drizzle-orm'
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

export type RackRow = typeof racks.$inferSelect
export type ShelfRow = typeof rack_shelves.$inferSelect

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

function newId(): string {
	return Bun.randomUUIDv7()
}

function shelfSpanOf(row: ShelfRow): OccupantSpan {
	return { id: row.id, name: row.name, position_u: row.position_u, height_u: row.height_u }
}

// ---------------------------------------------------------------------------
// Racks
// ---------------------------------------------------------------------------

export interface RackListParams extends ListParams {
	site?: string
	location?: string
	tenant?: string
}

export function listRacks(params: RackListParams): Page<RackRow> {
	const db = getDb()
	const pattern = searchPattern(params.search)
	const conditions: SQL[] = []
	if (params.search) {
		conditions.push(
			sql`(${racks.name} LIKE ${pattern} ESCAPE '\\' OR ${racks.slug} LIKE ${pattern} ESCAPE '\\')`,
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
	const where = conditions.length > 0 ? and(...conditions) : undefined
	const items = db
		.select()
		.from(racks)
		.where(where)
		.orderBy(asc(racks.name))
		.limit(params.limit)
		.offset(offsetOf(params))
		.all()
	const totalRow = db.select({ n: count() }).from(racks).where(where).get()
	return pageOf(items, totalRow?.n ?? 0, params)
}

export function getRack(id: string): Result<RackRow, Error> {
	const row = getDb().select().from(racks).where(eq(racks.id, id)).get()
	if (!row) {
		return Result.err(new NotFoundError('Rack not found'))
	}
	return Result.ok(row)
}

function checkTenant(tenantId: string | null | undefined): Result<undefined, Error> {
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
	locationId: string | null | undefined,
	siteId: string,
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
function shelvesOf(rackId: string): ShelfRow[] {
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
export function deviceSpansOf(rackId: string): OccupantSpan[] {
	const rows = getDb()
		.select({
			id: devices.id,
			name: devices.name,
			position_u: devices.position_u,
			u_height: device_types.u_height,
		})
		.from(devices)
		.innerJoin(device_types, eq(devices.device_type_id, device_types.id))
		.where(eq(devices.rack_id, rackId))
		.orderBy(asc(devices.position_u))
		.all()
	const spans: OccupantSpan[] = []
	for (const row of rows) {
		if (row.position_u === null) {
			continue
		}
		spans.push({
			id: row.id,
			name: row.name,
			position_u: row.position_u,
			height_u: row.u_height,
		})
	}
	return spans
}

/** Every U-consuming span of a rack: shelves plus position-mounted devices. */
function allSpansOf(rackId: string): OccupantSpan[] {
	return [...shelvesOf(rackId).map(shelfSpanOf), ...deviceSpansOf(rackId)]
}

export function createRack(input: RackCreate): Result<RackRow, Error> {
	const db = getDb()
	const site = db.select().from(sites).where(eq(sites.id, input.site_id)).get()
	if (!site) {
		return Result.err(new NotFoundError('Site not found'))
	}
	const tenantCheck = checkTenant(input.tenant_id)
	if (Result.isError(tenantCheck)) {
		return Result.err(tenantCheck.error)
	}
	const locationCheck = checkLocation(input.location_id, input.site_id)
	if (Result.isError(locationCheck)) {
		return Result.err(locationCheck.error)
	}
	const clash = db.select().from(racks).where(eq(racks.slug, input.slug)).get()
	if (clash) {
		return Result.err(new DuplicateError('Rack slug is already in use'))
	}
	const row: RackRow = {
		id: newId(),
		site_id: input.site_id,
		location_id: input.location_id ?? null,
		tenant_id: input.tenant_id ?? null,
		name: input.name,
		slug: input.slug,
		height_u: input.height_u ?? 42,
		status: input.status ?? 'active',
	}
	try {
		db.insert(racks).values(row).run()
	} catch (err) {
		if (isUniqueViolation(err)) {
			return Result.err(new DuplicateError('Rack slug is already in use'))
		}
		return Result.err(err instanceof Error ? err : new Error(String(err)))
	}
	return Result.ok(row)
}

export function updateRack(id: string, input: RackUpdate): Result<RackRow, Error> {
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
	if (input.slug !== undefined && input.slug !== node.slug) {
		const clash = db.select().from(racks).where(eq(racks.slug, input.slug)).get()
		if (clash) {
			return Result.err(new DuplicateError('Rack slug is already in use'))
		}
	}
	const effectiveHeight = input.height_u ?? node.height_u
	if (effectiveHeight !== node.height_u) {
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
	if (input.slug !== undefined) {
		patch.slug = input.slug
	}
	if (input.location_id !== undefined) {
		patch.location_id = input.location_id
	}
	if (input.tenant_id !== undefined) {
		patch.tenant_id = input.tenant_id
	}
	if (input.height_u !== undefined) {
		patch.height_u = input.height_u
	}
	if (input.status !== undefined) {
		patch.status = input.status
	}
	if (Object.keys(patch).length > 0) {
		try {
			db.update(racks).set(patch).where(eq(racks.id, id)).run()
		} catch (err) {
			if (isUniqueViolation(err)) {
				return Result.err(new DuplicateError('Rack slug is already in use'))
			}
			return Result.err(err instanceof Error ? err : new Error(String(err)))
		}
	}
	return getRack(id)
}

export function deleteRack(id: string): Result<RackRow, Error> {
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
export function getElevation(id: string): Result<ElevationResponse, Error> {
	const current = getRack(id)
	if (Result.isError(current)) {
		return current
	}
	const rack = current.value
	const shelves = shelvesOf(id)
	const occupancy = getOccupancy(rack.height_u, shelves.map(shelfSpanOf), deviceSpansOf(id))
	if (Result.isError(occupancy)) {
		return Result.err(occupancy.error)
	}
	const units: ElevationUnit[] = [...occupancy.value.units]
		.reverse()
		.map((u) => ({ u: u.u, shelf: u.shelf, device: u.device }))
	return Result.ok({ rack_id: rack.id, height_u: rack.height_u, units })
}

// ---------------------------------------------------------------------------
// Shelves
// ---------------------------------------------------------------------------

export interface ShelfListParams extends ListParams {
	rack?: string
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

export function getShelf(id: string): Result<ShelfRow, Error> {
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
		id: '',
		name: input.name,
		position_u: input.position_u,
		height_u: input.height_u ?? 1,
	}
	const bounds = checkBounds(candidate, rack.value.height_u, `Shelf "${input.name}"`)
	if (Result.isError(bounds)) {
		return Result.err(bounds.error)
	}
	const siblings = allSpansOf(input.rack_id)
	const overlap = checkOverlap(candidate, siblings, `Shelf "${input.name}"`)
	if (Result.isError(overlap)) {
		return Result.err(overlap.error)
	}
	const row: ShelfRow = {
		id: newId(),
		rack_id: input.rack_id,
		name: input.name,
		position_u: input.position_u,
		height_u: input.height_u ?? 1,
		capacity_slots: input.capacity_slots ?? null,
	}
	getDb().insert(rack_shelves).values(row).run()
	return Result.ok(row)
}

export function updateShelf(id: string, input: ShelfUpdate): Result<ShelfRow, Error> {
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
	const bounds = checkBounds(effective, rack.value.height_u, `Shelf "${effectiveName}"`)
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

export function deleteShelf(id: string): Result<ShelfRow, Error> {
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
