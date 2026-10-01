import { Result } from 'better-result'
import { and, asc, count, desc, eq, inArray, type SQL, sql } from 'drizzle-orm'
import type {
	ElevationResponse,
	ElevationShelfDeviceRef,
	ElevationShelfRef,
	ElevationUnit,
	RackCreate,
	RackUpdate,
} from 'shared/src/schemas'
import { device_types, devices, locations, racks, shelves, sites } from '../schema'
import { checkBounds, getOccupancy, type OccupantSpan } from '../services/occupancy'
import { logCreate, logDelete, logUpdate } from './changelog'
import { getDb } from './connection'
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

type RackRecord = typeof racks.$inferSelect
/** Rack height is computed from the linked rack type, not stored on racks. */
export type RackRow = Omit<RackRecord, 'height_u'> & { height_u: number }

async function withRackHeights(rows: RackRecord[]): Promise<RackRow[]> {
	const typeIds = [...new Set(rows.map((r) => r.rack_type_id).filter((id) => id !== null))]
	const heights = new Map<number, number>()
	if (typeIds.length > 0) {
		for (const row of await getDb()
			.select({ id: device_types.id, u_height: device_types.u_height })
			.from(device_types)
			.where(inArray(device_types.id, typeIds as number[]))) {
			heights.set(row.id, row.u_height)
		}
	}
	return rows.map((row) => ({
		...row,
		height_u: row.rack_type_id === null ? 0 : (heights.get(row.rack_type_id) ?? 0),
	}))
}

async function withRackHeight(row: RackRecord): Promise<RackRow> {
	return (await withRackHeights([row]))[0] as RackRow
}

// ---------------------------------------------------------------------------
// Racks
// ---------------------------------------------------------------------------

export interface RackListParams extends ListParams, TenantFilterParams {
	site?: number
	location?: number
	sort: 'name'
	order: 'asc' | 'desc'
}

export async function listRacks(params: RackListParams): Promise<Page<RackRow>> {
	const db = getDb()
	const pattern = searchPattern(params.search)
	const conditions: SQL[] = []
	if (params.search) {
		conditions.push(
			sql`(${racks.name} ILIKE ${pattern} ESCAPE '\\' OR ${racks.description} ILIKE ${pattern} ESCAPE '\\')`,
		)
	}
	if (params.site) {
		conditions.push(eq(racks.site_id, params.site))
	}
	if (params.location) {
		conditions.push(eq(racks.location_id, params.location))
	}
	conditions.push(...tenantConditions(racks.tenant_id, params))
	const where = conditions.length > 0 ? and(...conditions) : undefined
	const rows = await db
		.select()
		.from(racks)
		.where(where)
		.orderBy(params.order === 'desc' ? desc(racks.name) : asc(racks.name), asc(racks.id))
		.limit(params.limit)
		.offset(offsetOf(params))
	const items = await withRackHeights(rows)
	const totalRow = (await db.select({ n: count() }).from(racks).where(where).limit(1))[0]
	return pageOf(items, totalRow?.n ?? 0, params)
}

export async function getRack(id: number): Promise<Result<RackRow, Error>> {
	const row = (await getDb().select().from(racks).where(eq(racks.id, id)).limit(1))[0]
	if (!row) {
		return Result.err(new NotFoundError('Rack not found'))
	}
	return Result.ok(await withRackHeight(row))
}

/**
 * Authoritative rack height in U, supplied by the rack type.
 */
export async function rackHeightOf(rack: Pick<RackRecord, 'rack_type_id'>): Promise<number> {
	if (rack.rack_type_id === null) {
		return 0
	}
	return (
		(
			await getDb()
				.select({ u_height: device_types.u_height })
				.from(device_types)
				.where(eq(device_types.id, rack.rack_type_id))
				.limit(1)
		)[0]?.u_height ?? 0
	)
}

/** Location must exist and belong to the rack's site; null clears the link. */
async function checkLocation(
	locationId: number | null | undefined,
	siteId: number,
): Promise<Result<undefined, Error>> {
	if (locationId === null || locationId === undefined) {
		return Result.ok(undefined)
	}
	const location = (
		await getDb().select().from(locations).where(eq(locations.id, locationId)).limit(1)
	)[0]
	if (!location || location.site_id !== siteId) {
		return Result.err(new NotFoundError('Location not found in this site'))
	}
	return Result.ok(undefined)
}

/**
 * U-consuming device spans of one rack. Devices span their template
 * `u_height`. Shelves contribute separately via `shelfSpansOf`. Exported so
 * `db/devices.ts` and `db/shelves.ts` validate mounts against the same rows
 * the elevation renders.
 */
export async function deviceSpansOf(rackId: number): Promise<OccupantSpan[]> {
	return (await deviceDetailsOf(rackId)).map((d) => ({
		id: d.id,
		name: d.name,
		position_u: d.position_u,
		height_u: d.u_height,
		face: d.face,
		is_full_depth: d.is_full_depth,
	}))
}

/** Full device mount details behind each span, for the enriched elevation. */
export async function deviceDetailsOf(rackId: number): Promise<
	{
		id: number
		name: string
		position_u: number
		u_height: number
		face: 'front' | 'rear' | null
		status: string
		device_type_id: number
		device_type_model: string
		is_full_depth: boolean
	}[]
> {
	const rows = await getDb()
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

/** Full shelf mount details for one rack, ordered by bottom-U. */
export async function shelfDetailsOf(rackId: number): Promise<ElevationShelfRef[]> {
	const rows = await getDb()
		.select()
		.from(shelves)
		.where(eq(shelves.rack_id, rackId))
		.orderBy(asc(shelves.position_u))
	const onShelves = new Map<number, ElevationShelfDeviceRef[]>()
	const shelved = await getDb()
		.select({
			id: devices.id,
			name: devices.name,
			status: devices.status,
			shelf_id: devices.shelf_id,
			device_type_model: device_types.model,
		})
		.from(devices)
		.innerJoin(device_types, eq(devices.device_type_id, device_types.id))
		.where(and(eq(devices.rack_id, rackId), sql`${devices.shelf_id} IS NOT NULL`))
		.orderBy(asc(devices.name), asc(devices.id))
	for (const { shelf_id, ...device } of shelved) {
		if (shelf_id === null) {
			continue
		}
		const list = onShelves.get(shelf_id) ?? []
		list.push(device)
		onShelves.set(shelf_id, list)
	}
	return rows.map((row) => ({
		id: row.id,
		name: row.name,
		face: row.face === 'front' || row.face === 'rear' ? row.face : null,
		position_u: row.position_u,
		mount_height: row.mount_height,
		mount_usable: row.mount_usable !== 0,
		reserved_height: row.reserved_height,
		is_full_depth: row.is_full_depth !== 0,
		devices: onShelves.get(row.id) ?? [],
	}))
}

/**
 * Blocked U range of a shelf: the mount span counts unless `mount_usable`
 * is set; the reserved span always counts. Returns null when nothing is
 * blocked (mount usable with no reserve).
 */
export function shelfBlockedRange(shelf: {
	position_u: number
	mount_height: number
	mount_usable: boolean
	reserved_height: number
}): { position_u: number; height_u: number } | null {
	const total = shelf.mount_height + shelf.reserved_height
	if (shelf.mount_usable) {
		if (shelf.reserved_height <= 0) {
			return null
		}
		return {
			position_u: shelf.position_u + shelf.mount_height,
			height_u: shelf.reserved_height,
		}
	}
	if (total <= 0) {
		return null
	}
	return { position_u: shelf.position_u, height_u: total }
}

/**
 * U-blocking shelf spans of one rack (at most one span per shelf).
 * Exported so device and shelf validation share the elevation's rows.
 */
export async function shelfSpansOf(rackId: number): Promise<OccupantSpan[]> {
	const spans: OccupantSpan[] = []
	for (const s of await shelfDetailsOf(rackId)) {
		const blocked = shelfBlockedRange(s)
		if (!blocked) {
			continue
		}
		spans.push({
			id: -s.id,
			name: s.name ?? 'shelf',
			position_u: blocked.position_u,
			height_u: blocked.height_u,
			face: s.face,
			is_full_depth: s.is_full_depth,
		})
	}
	return spans
}

/** All U-consuming spans of one rack: devices plus shelf blockers. */
export async function rackSpansOf(rackId: number): Promise<OccupantSpan[]> {
	return [...(await deviceSpansOf(rackId)), ...(await shelfSpansOf(rackId))]
}

export async function createRack(input: RackCreate): Promise<Result<RackRow, Error>> {
	const db = getDb()
	const site = (await db.select().from(sites).where(eq(sites.id, input.site_id)).limit(1))[0]
	if (!site) {
		return Result.err(new NotFoundError('Site not found'))
	}
	const rackType = (
		await db.select().from(device_types).where(eq(device_types.id, input.rack_type_id)).limit(1)
	)[0]
	if (!rackType || rackType.form_factor === null) {
		return Result.err(new NotFoundError('Rack type not found'))
	}
	const tenantCheck = await checkTenantExists(input.tenant_id)
	if (Result.isError(tenantCheck)) {
		return Result.err(tenantCheck.error)
	}
	const locationCheck = await checkLocation(input.location_id, input.site_id)
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
		const inserted = (await db.insert(racks).values(row).returning({ id: racks.id }))[0]
		if (!inserted) {
			return Result.err(new Error('Rack insert did not return an id'))
		}
		return await logCreate('rack', await getRack(inserted.id))
	} catch (err) {
		if (isUniqueViolation(err)) {
			return Result.err(new DuplicateError('Rack name is already in use'))
		}
		return Result.err(err instanceof Error ? err : new Error(String(err)))
	}
}

export async function updateRack(id: number, input: RackUpdate): Promise<Result<RackRow, Error>> {
	const current = await getRack(id)
	if (Result.isError(current)) {
		return current
	}
	const node = current.value
	if (input.tenant_id !== undefined) {
		const tenantCheck = await checkTenantExists(input.tenant_id)
		if (Result.isError(tenantCheck)) {
			return Result.err(tenantCheck.error)
		}
	}
	if (input.location_id !== undefined) {
		const locationCheck = await checkLocation(input.location_id, node.site_id)
		if (Result.isError(locationCheck)) {
			return Result.err(locationCheck.error)
		}
	}
	const db = getDb()
	let newTypeHeight: number | null = null
	if (input.rack_type_id !== undefined) {
		const rackType = (
			await db
				.select()
				.from(device_types)
				.where(eq(device_types.id, input.rack_type_id))
				.limit(1)
		)[0]
		if (!rackType || rackType.form_factor === null) {
			return Result.err(new NotFoundError('Rack type not found'))
		}
		newTypeHeight = rackType.u_height
	}
	const storedHeight = await rackHeightOf(node)
	const effectiveHeight = newTypeHeight ?? storedHeight
	if (effectiveHeight !== storedHeight) {
		// Shrinking below the topmost occupied U would strand devices outside
		// the rack; reject with the same bounds error
		// creation uses.
		for (const span of await rackSpansOf(id)) {
			const bounds = checkBounds(span, effectiveHeight, `Device "${span.name}"`)
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
	if (!isPatchEmpty(patch)) {
		try {
			await db.update(racks).set(patch).where(eq(racks.id, id))
		} catch (err) {
			if (isUniqueViolation(err)) {
				return Result.err(new DuplicateError('Rack name is already in use'))
			}
			return Result.err(err instanceof Error ? err : new Error(String(err)))
		}
	}
	return await logUpdate('rack', current.value, await getRack(id))
}

export async function deleteRack(id: number): Promise<Result<RackRow, Error>> {
	const current = await getRack(id)
	if (Result.isError(current)) {
		return current
	}
	const device = (await getDb().select().from(devices).where(eq(devices.rack_id, id)).limit(1))[0]
	if (device) {
		return Result.err(new ConflictError('Rack still has devices; move or delete them first'))
	}
	const shelf = (await getDb().select().from(shelves).where(eq(shelves.rack_id, id)).limit(1))[0]
	if (shelf) {
		return Result.err(new ConflictError('Rack still has shelves; move or delete them first'))
	}
	try {
		await getDb().delete(racks).where(eq(racks.id, id))
	} catch (e) {
		return Result.err(errOf(e))
	}
	return await logDelete('rack', current.value)
}

/** Ordered U map of a rack, top-down (highest U first). */
export async function getElevation(id: number): Promise<Result<ElevationResponse, Error>> {
	const current = await getRack(id)
	if (Result.isError(current)) {
		return current
	}
	const rack = current.value
	const heightU = await rackHeightOf(rack)
	const details = await deviceDetailsOf(id)
	const shelfDetails = await shelfDetailsOf(id)
	const occupancy = getOccupancy(heightU, [
		...details.map((d) => ({
			id: d.id,
			name: d.name,
			position_u: d.position_u,
			height_u: d.u_height,
			face: d.face,
			is_full_depth: d.is_full_depth,
		})),
		...(await shelfSpansOf(id)),
	])
	if (Result.isError(occupancy)) {
		return Result.err(occupancy.error)
	}
	const blockedU = (await shelfSpansOf(id)).reduce((sum, s) => sum + s.height_u, 0)
	const deviceById = new Map(details.map((d) => [d.id, d]))
	const shelfAt = (u: number): ElevationShelfRef[] =>
		shelfDetails.filter((s) => {
			const blocked = shelfBlockedRange(s)
			if (!blocked) {
				return false
			}
			return u >= blocked.position_u && u < blocked.position_u + blocked.height_u
		})
	const toRef = (
		deviceRow: (typeof details)[number],
	): ElevationResponse['units'][number]['device'] => ({
		id: deviceRow.id,
		name: deviceRow.name,
		face: deviceRow.face,
		position_u: deviceRow.position_u,
		u_height: deviceRow.u_height,
		status: deviceRow.status,
		device_type_id: deviceRow.device_type_id,
		device_type_model: deviceRow.device_type_model,
		is_full_depth: deviceRow.is_full_depth,
	})
	const units: ElevationUnit[] = [...occupancy.value.units].reverse().map((u) => {
		const deviceId = u.device?.id ?? null
		const deviceRow = deviceId !== null && deviceId > 0 ? deviceById.get(deviceId) : undefined
		const at = shelfAt(u.u)
		return {
			u: u.u,
			device: deviceRow === undefined ? null : toRef(deviceRow),
			devices: details
				.filter((d) => d.position_u <= u.u && d.position_u + d.u_height > u.u)
				.map((d) => ({
					id: d.id,
					name: d.name,
					face: d.face,
					position_u: d.position_u,
					u_height: d.u_height,
					status: d.status,
					device_type_id: d.device_type_id,
					device_type_model: d.device_type_model,
					is_full_depth: d.is_full_depth,
				})),
			shelf: at[0] ?? null,
			shelves: at,
		}
	})
	return Result.ok({
		rack_id: rack.id,
		height_u: heightU,
		units,
		reserved_u: blockedU,
		shelves: shelfDetails,
	})
}
