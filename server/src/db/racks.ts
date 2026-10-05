import { Result } from 'better-result'
import { and, asc, eq, inArray, isNotNull } from 'drizzle-orm'
import type {
	ElevationDeviceRef,
	ElevationResponse,
	ElevationShelfDeviceRef,
	ElevationShelfRef,
	ElevationUnit,
	RackCreate,
	RackUpdate,
} from 'shared/src/schemas'
import { device_types, devices, locations, racks, shelves, sites } from '../schema'
import { checkBounds, faceOf, getOccupancy, type OccupantSpan } from '../services/occupancy'
import { logCreate, logDelete, logUpdate } from './changelog'
import { getDb } from './connection'
import { ConflictError, NotFoundError } from './errors'
import type { ListParams, Page, TenantFilterParams } from './list'
import {
	checkExists,
	checkTenantExists,
	exists,
	findById,
	findOne,
	insertedId,
	isPatchEmpty,
	orderOf,
	pageRows,
	pickDefined,
	searchCondition,
	tenantConditions,
	tryWrite,
} from './list'

type RackRecord = typeof racks.$inferSelect
/** Rack height is computed from the linked rack type, not stored on racks. */
export type RackRow = Omit<RackRecord, 'height_u'> & { height_u: number }

async function withRackHeights(rows: RackRecord[]): Promise<RackRow[]> {
	const typeIds = [
		...new Set(rows.map((r) => r.rack_type_id).filter((id): id is number => id !== null)),
	]
	const heights = new Map<number, number>()
	if (typeIds.length > 0) {
		for (const row of await getDb()
			.select({ id: device_types.id, u_height: device_types.u_height })
			.from(device_types)
			.where(inArray(device_types.id, typeIds))) {
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

const RACK_NAME_IN_USE = 'Rack name is already in use'

export interface RackListParams extends ListParams, TenantFilterParams {
	site?: number
	location?: number
	sort: 'name'
	order: 'asc' | 'desc'
}

export async function listRacks(params: RackListParams): Promise<Page<RackRow>> {
	const where = and(
		searchCondition(params.search, [racks.name, racks.description]),
		params.site ? eq(racks.site_id, params.site) : undefined,
		params.location ? eq(racks.location_id, params.location) : undefined,
		...tenantConditions(racks.tenant_id, params),
	)
	const page = await pageRows(
		racks,
		where,
		[orderOf(racks.name, params.order), asc(racks.id)],
		params,
	)
	return { ...page, items: await withRackHeights(page.items) }
}

export async function getRack(id: number): Promise<Result<RackRow, Error>> {
	const row = await findById(racks, id, 'Rack not found')
	return Result.isOk(row) ? Result.ok(await withRackHeight(row.value)) : row
}

/** Authoritative rack height in U, supplied by the rack type. */
export async function rackHeightOf(rack: Pick<RackRecord, 'rack_type_id'>): Promise<number> {
	if (rack.rack_type_id === null) {
		return 0
	}
	return (await findOne(device_types, eq(device_types.id, rack.rack_type_id)))?.u_height ?? 0
}

/** Location must exist and belong to the rack's site; null clears the link. */
async function checkLocation(
	locationId: number | null | undefined,
	siteId: number,
): Promise<Result<undefined, Error>> {
	if (locationId === null || locationId === undefined) {
		return Result.ok(undefined)
	}
	if (
		!(await exists(locations, and(eq(locations.id, locationId), eq(locations.site_id, siteId))))
	) {
		return Result.err(new NotFoundError('Location not found in this site'))
	}
	return Result.ok(undefined)
}

/** Rack type row (a device type with a form factor); 404 otherwise. */
async function getRackType(id: number): Promise<Result<typeof device_types.$inferSelect, Error>> {
	const type = await findOne(device_types, eq(device_types.id, id))
	if (!type || type.form_factor === null) {
		return Result.err(new NotFoundError('Rack type not found'))
	}
	return Result.ok(type)
}

/** A U-mounted device with its type, as the elevation shows it. */
type MountedDevice = ElevationDeviceRef

function spanOf(device: MountedDevice): OccupantSpan {
	return {
		id: device.id,
		name: device.name,
		position_u: device.position_u,
		height_u: device.u_height,
		face: device.face,
		is_full_depth: device.is_full_depth,
	}
}

/**
 * U-consuming device spans of one rack. Devices span their template
 * `u_height`. Shelves contribute separately via `shelfSpansOf`. Exported so
 * `db/devices.ts` and `db/shelves.ts` validate mounts against the same rows
 * the elevation renders.
 */
export async function deviceSpansOf(rackId: number): Promise<OccupantSpan[]> {
	return (await deviceDetailsOf(rackId)).map(spanOf)
}

/** Full device mount details behind each span, for the enriched elevation. */
async function deviceDetailsOf(rackId: number): Promise<MountedDevice[]> {
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
		.where(and(eq(devices.rack_id, rackId), isNotNull(devices.position_u)))
		.orderBy(asc(devices.position_u))
	return rows.map((row) => ({
		...row,
		position_u: row.position_u as number,
		face: faceOf(row.face),
		is_full_depth: row.is_full_depth !== 0,
	}))
}

/** Full shelf mount details for one rack, ordered by bottom-U. */
async function shelfDetailsOf(rackId: number): Promise<ElevationShelfRef[]> {
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
		.where(and(eq(devices.rack_id, rackId), isNotNull(devices.shelf_id)))
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
		face: faceOf(row.face),
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

/** U-blocking spans of shelves (at most one span per shelf). */
function shelfSpans(details: ElevationShelfRef[]): OccupantSpan[] {
	const spans: OccupantSpan[] = []
	for (const s of details) {
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
	return [...(await deviceSpansOf(rackId)), ...shelfSpans(await shelfDetailsOf(rackId))]
}

export async function createRack(input: RackCreate): Promise<Result<RackRow, Error>> {
	for (const guard of [
		await checkExists(sites, input.site_id, 'Site not found'),
		await getRackType(input.rack_type_id),
		await checkTenantExists(input.tenant_id),
		await checkLocation(input.location_id, input.site_id),
	]) {
		if (Result.isError(guard)) {
			return guard
		}
	}
	const row: Omit<RackRecord, 'id'> = {
		site_id: input.site_id,
		location_id: input.location_id ?? null,
		tenant_id: input.tenant_id ?? null,
		rack_type_id: input.rack_type_id,
		name: input.name,
		description: input.description ?? null,
	}
	const id = await tryWrite(
		async () => insertedId(await getDb().insert(racks).values(row).returning({ id: racks.id })),
		RACK_NAME_IN_USE,
	)
	if (Result.isError(id)) {
		return id
	}
	return await logCreate('rack', await getRack(id.value))
}

export async function updateRack(id: number, input: RackUpdate): Promise<Result<RackRow, Error>> {
	const current = await getRack(id)
	if (Result.isError(current)) {
		return current
	}
	const node = current.value
	for (const guard of [
		await checkTenantExists(input.tenant_id),
		await checkLocation(input.location_id, node.site_id),
	]) {
		if (Result.isError(guard)) {
			return guard
		}
	}
	let effectiveHeight = node.height_u
	if (input.rack_type_id !== undefined) {
		const rackType = await getRackType(input.rack_type_id)
		if (Result.isError(rackType)) {
			return rackType
		}
		effectiveHeight = rackType.value.u_height
	}
	if (effectiveHeight !== node.height_u) {
		// Shrinking below the topmost occupied U would strand devices outside
		// the rack; reject with the same bounds error creation uses.
		for (const span of await rackSpansOf(id)) {
			const bounds = checkBounds(span, effectiveHeight, `Device "${span.name}"`)
			if (Result.isError(bounds)) {
				return bounds
			}
		}
	}
	const patch = pickDefined(input, [
		'name',
		'rack_type_id',
		'location_id',
		'tenant_id',
		'description',
	])
	if (!isPatchEmpty(patch)) {
		const written = await tryWrite(
			() => getDb().update(racks).set(patch).where(eq(racks.id, id)),
			RACK_NAME_IN_USE,
		)
		if (Result.isError(written)) {
			return written
		}
	}
	return await logUpdate('rack', node, await getRack(id))
}

export async function deleteRack(id: number): Promise<Result<RackRow, Error>> {
	const current = await getRack(id)
	if (Result.isError(current)) {
		return current
	}
	if (await exists(devices, eq(devices.rack_id, id))) {
		return Result.err(new ConflictError('Rack still has devices; move or delete them first'))
	}
	if (await exists(shelves, eq(shelves.rack_id, id))) {
		return Result.err(new ConflictError('Rack still has shelves; move or delete them first'))
	}
	const deleted = await tryWrite(() => getDb().delete(racks).where(eq(racks.id, id)))
	if (Result.isError(deleted)) {
		return deleted
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
	const details = await deviceDetailsOf(id)
	const shelfDetails = await shelfDetailsOf(id)
	const blockers = shelfSpans(shelfDetails)
	const occupancy = getOccupancy(rack.height_u, [...details.map(spanOf), ...blockers])
	if (Result.isError(occupancy)) {
		return occupancy
	}
	const deviceById = new Map(details.map((d) => [d.id, d]))
	const shelvesAt = (u: number): ElevationShelfRef[] =>
		shelfDetails.filter((s) => {
			const blocked = shelfBlockedRange(s)
			return (
				blocked !== null &&
				u >= blocked.position_u &&
				u < blocked.position_u + blocked.height_u
			)
		})
	const units: ElevationUnit[] = [...occupancy.value.units].reverse().map((u) => {
		const deviceId = u.device?.id ?? null
		const at = shelvesAt(u.u)
		return {
			u: u.u,
			device: (deviceId !== null && deviceId > 0 ? deviceById.get(deviceId) : null) ?? null,
			devices: details.filter((d) => d.position_u <= u.u && d.position_u + d.u_height > u.u),
			shelf: at[0] ?? null,
			shelves: at,
		}
	})
	return Result.ok({
		rack_id: rack.id,
		height_u: rack.height_u,
		units,
		reserved_u: blockers.reduce((sum, s) => sum + s.height_u, 0),
		shelves: shelfDetails,
	})
}
