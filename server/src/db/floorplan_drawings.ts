/**
 * Drawn floor plans (v2): a sheet in centimeters per site or location with
 * walls, doors, windows, pillars, room dividers, stairs, cable trays, desks,
 * desk groups and rooms drawn on it,
 * optionally over a reference image (an attachment of the same owner), and
 * rack, device and outlet markers.
 *
 * The drawn elements are one JSON document per kind, replaced with every
 * save. Desks (also those of desk groups) and rooms may link to a location of the owner's scope by id:
 * new links are checked on save, and reads resolve them (`linked_locations`)
 * as far as the location exists and the requester may see it.
 * Markers reference racks, devices, rear ports and jacks, so they live in
 * `floorplan_drawing_placements`; each object sits on at most one drawn
 * plan. Like the image plans (`attachments.ts`), markers outside a scoped
 * requester's tenants are left out of reads and kept as they are on save.
 * Walls, doors, windows, pillars, dividers, stairs, trays, desks and markers carry their
 * heights above the floor (cm); a placed rack reads its height in units
 * from its rack type.
 *
 * Plans of locations sharing a parent (the floors of a building) stack, as
 * do the plans of a site's top-level floors (`type` floor, the site then
 * being the one building). Each may carry its storey (`level`, unique per
 * building) and the building point of its sheet's top-left corner
 * (`offset_x` / `offset_y`), so the floors share one frame and each can
 * show another under its drawing.
 */
import { Result } from 'better-result'
import {
	and,
	asc,
	count,
	eq,
	getTableColumns,
	inArray,
	isNull,
	ne,
	notInArray,
	or,
	type SQL,
	sql,
} from 'drizzle-orm'
import { alias, type PgColumn } from 'drizzle-orm/pg-core'
import type {
	FloorplanCandidateJson,
	FloorplanDrawingCreate,
	FloorplanDrawingJson,
	FloorplanDrawingListJson,
	FloorplanDrawingPut,
	FloorplanDrawingRefJson,
	FloorplanLinkLocationJson,
	FloorplanReference,
	FloorplanStackFloorJson,
} from 'shared/src/schemas'
import {
	attachments,
	device_roles,
	devices,
	floorplan_drawing_placements,
	floorplan_drawings,
	interfaces,
	locations,
	panel_jacks,
	rack_types,
	racks,
	sites,
	tenants,
} from '../schema'
import { nowSeconds } from '../util/time'
import {
	type AttachmentOwner,
	toJson as attachmentJson,
	checkOutlets,
	containedIn,
	firstJackPort,
	outletNameSql,
	outletPorts,
	outsideScope,
	ownerLocations,
	panelLinkedSql,
	portColumns,
	portDevice,
	portOf,
	siteOfOwner,
	visibleTo,
} from './attachments'
import { logCreate, logDelete, logUpdate } from './changelog'
import { getDb, withTransaction } from './connection'
import { ConflictError, NotFoundError, ValidationError } from './errors'
import {
	checkExists,
	findById,
	insertedId,
	type ListParams,
	offsetOf,
	orderOf,
	type Page,
	pageOf,
	scopeCondition,
	searchCondition,
	type TenantFilterParams,
	tenantConditions,
	tryWrite,
} from './list'

type DrawingRow = typeof floorplan_drawings.$inferSelect

const NOT_FOUND = 'Drawn floor plan not found'
const OWNER_TAKEN = 'This site or location already has a drawn floor plan'
const ALREADY_PLACED = 'A rack, device or outlet is already placed on another drawn floor plan'

/** Joins `interfaces` to a marker's outlet: the placed port, or the first port of the placed jack. */
const placedPortJoin: SQL = sql`${interfaces.id} = coalesce(${floorplan_drawing_placements.interface_id}, ${firstJackPort(floorplan_drawing_placements.jack_id)})`

/** Tenant of a marker's object: its rack, device or outlet panel. */
const placementTenantSql: SQL<number | null> = sql<
	number | null
>`coalesce(${racks.tenant_id}, ${devices.tenant_id}, ${portDevice.tenant_id})`

function ownerOf(row: Pick<DrawingRow, 'site_id' | 'location_id'>): AttachmentOwner {
	return row.site_id !== null ? { site_id: row.site_id } : { location_id: row.location_id ?? 0 }
}

function ownerCondition(owner: AttachmentOwner): SQL {
	return owner.site_id !== undefined
		? eq(floorplan_drawings.site_id, owner.site_id)
		: eq(floorplan_drawings.location_id, owner.location_id ?? 0)
}

/**
 * Row plus the tenant of its owning site or location (`null` when shared),
 * in one statement for the access gate.
 */
export async function getDrawingWithTenant(
	id: number,
): Promise<Result<{ row: DrawingRow; tenant: number | null }, Error>> {
	const [found] = await getDb()
		.select({
			...getTableColumns(floorplan_drawings),
			owner_tenant: sql<number | null>`coalesce(${sites.tenant_id}, ${locations.tenant_id})`,
		})
		.from(floorplan_drawings)
		.leftJoin(sites, eq(sites.id, floorplan_drawings.site_id))
		.leftJoin(locations, eq(locations.id, floorplan_drawings.location_id))
		.where(eq(floorplan_drawings.id, id))
		.limit(1)
	if (!found) {
		return Result.err(new NotFoundError(NOT_FOUND))
	}
	const { owner_tenant, ...row } = found
	return Result.ok({ row, tenant: owner_tenant })
}

/** The drawn plan of a site or location, or `null` without one. */
export async function getDrawingRef(
	owner: AttachmentOwner,
): Promise<Result<FloorplanDrawingRefJson | null, Error>> {
	const found = await checkOwner(owner)
	if (Result.isError(found)) {
		return found
	}
	const [row] = await getDb()
		.select({ id: floorplan_drawings.id })
		.from(floorplan_drawings)
		.where(ownerCondition(owner))
	return Result.ok(row ?? null)
}

function checkOwner(owner: AttachmentOwner): Promise<Result<undefined, Error>> {
	return owner.site_id !== undefined
		? checkExists(sites, owner.site_id, 'Site not found')
		: checkExists(locations, owner.location_id, 'Location not found')
}

/** Creates the empty drawn plan of a site or location (one per owner). */
export async function createDrawing(
	input: FloorplanDrawingCreate,
): Promise<Result<FloorplanDrawingJson, Error>> {
	const owner: AttachmentOwner =
		input.site_id !== undefined
			? { site_id: input.site_id }
			: { location_id: input.location_id }
	const found = await checkOwner(owner)
	if (Result.isError(found)) {
		return found
	}
	const now = nowSeconds()
	const id = await tryWrite(
		async () =>
			insertedId(
				await getDb()
					.insert(floorplan_drawings)
					.values({
						site_id: owner.site_id ?? null,
						location_id: owner.location_id ?? null,
						width: input.width,
						height: input.height,
						created_at: now,
						updated_at: now,
					})
					.returning({ id: floorplan_drawings.id }),
			),
		OWNER_TAKEN,
	)
	if (Result.isError(id)) {
		return id
	}
	const row = await findById(floorplan_drawings, id.value, NOT_FOUND)
	if (Result.isError(row)) {
		return row
	}
	await logCreate('floorplan_drawing', Result.ok(await drawingSnapshot(row.value)))
	return getDrawing(id.value)
}

/** Name of the owning site or location. */
async function drawingOwnerName(row: Pick<DrawingRow, 'id'>): Promise<string> {
	const [owner] = await getDb()
		.select({ name: sql<string>`coalesce(${sites.name}, ${locations.name})` })
		.from(floorplan_drawings)
		.leftJoin(sites, eq(sites.id, floorplan_drawings.site_id))
		.leftJoin(locations, eq(locations.id, floorplan_drawings.location_id))
		.where(eq(floorplan_drawings.id, row.id))
	return owner?.name ?? `#${row.id}`
}

const parentLocation = alias(locations, 'parent_location')

/** A building of stacked floors: a location, or a site whose top-level floors stack. */
type Building = { location_id: number | null; site_id: number; name: string }

/**
 * The building whose floors' plans stack with the owner's: the owning
 * location's parent, or for a top-level floor its site; `null` for a site's
 * plan or another top-level location's.
 */
async function buildingOf(row: Pick<DrawingRow, 'location_id'>): Promise<Building | null> {
	if (row.location_id === null) {
		return null
	}
	const [found] = await getDb()
		.select({
			type: locations.type,
			site_id: locations.site_id,
			parent_id: parentLocation.id,
			parent_name: parentLocation.name,
			site_name: sites.name,
		})
		.from(locations)
		.innerJoin(sites, eq(sites.id, locations.site_id))
		.leftJoin(parentLocation, eq(parentLocation.id, locations.parent_id))
		.where(eq(locations.id, row.location_id))
	if (!found) {
		return null
	}
	if (found.parent_id !== null) {
		return {
			location_id: found.parent_id,
			site_id: found.site_id,
			name: found.parent_name ?? '',
		}
	}
	return found.type === 'floor'
		? { location_id: null, site_id: found.site_id, name: found.site_name }
		: null
}

/** Locations whose plans stack in `building`: its children, or the site's top-level floors. */
function floorsOf(building: Building): SQL | undefined {
	return building.location_id !== null
		? eq(locations.parent_id, building.location_id)
		: and(
				eq(locations.site_id, building.site_id),
				isNull(locations.parent_id),
				eq(locations.type, 'floor'),
			)
}

/**
 * The other floors of the plan's building with a plan, by storey (those
 * without one last), then name, leaving out locations outside
 * `scopeTenantIds`. Empty without a building.
 */
export async function listDrawingStack(
	id: number,
	scopeTenantIds?: readonly number[],
): Promise<Result<FloorplanStackFloorJson[], Error>> {
	const found = await findById(floorplan_drawings, id, NOT_FOUND)
	if (Result.isError(found)) {
		return found
	}
	const building = await buildingOf(found.value)
	if (building === null) {
		return Result.ok([])
	}
	const rows = await getDb()
		.select({
			id: floorplan_drawings.id,
			location_id: locations.id,
			owner_name: locations.name,
			level: floorplan_drawings.level,
			offset_x: floorplan_drawings.offset_x,
			offset_y: floorplan_drawings.offset_y,
		})
		.from(floorplan_drawings)
		.innerJoin(locations, eq(locations.id, floorplan_drawings.location_id))
		.where(
			and(
				floorsOf(building),
				ne(floorplan_drawings.id, id),
				scopeCondition(locations.tenant_id, scopeTenantIds),
			),
		)
		.orderBy(
			sql`${floorplan_drawings.level} asc nulls last`,
			asc(locations.name),
			asc(floorplan_drawings.id),
		)
	return Result.ok(
		rows.map(({ offset_x, offset_y, ...floor }) => ({
			...floor,
			offset: { x: offset_x, y: offset_y },
		})),
	)
}

/** Location ids the plan's desks, desk groups and rooms link to, each once. */
function linkedLocationIds(plan: {
	desks: { location_id?: number }[]
	desk_groups: { location_ids: (number | null)[] }[]
	rooms: { location_id?: number }[]
}): number[] {
	return [
		...new Set([
			...[...plan.desks, ...plan.rooms].flatMap((item) =>
				item.location_id === undefined ? [] : [item.location_id],
			),
			...plan.desk_groups.flatMap((group) =>
				group.location_ids.filter((id): id is number => id !== null),
			),
		]),
	]
}

// biome-ignore lint/nursery/useExplicitType: drizzle infers the selected row from this column map
const linkLocationColumns = {
	id: locations.id,
	name: locations.name,
	type: locations.type,
	parent_id: locations.parent_id,
}

/** The linked locations that exist and lie in `scopeTenantIds`. */
async function linkedLocations(
	ids: number[],
	scopeTenantIds: readonly number[] | undefined,
): Promise<FloorplanLinkLocationJson[]> {
	if (ids.length === 0) {
		return []
	}
	return getDb()
		.select(linkLocationColumns)
		.from(locations)
		.where(and(inArray(locations.id, ids), scopeCondition(locations.tenant_id, scopeTenantIds)))
		.orderBy(asc(locations.name), asc(locations.id))
}

/**
 * Locations in the owner's scope that desks and rooms may link to: the
 * site's locations, or the owning location and those below it. Leaves out
 * locations outside `scopeTenantIds`.
 */
export async function listDrawingLocations(
	id: number,
	scopeTenantIds?: readonly number[],
): Promise<Result<FloorplanLinkLocationJson[], Error>> {
	const found = await findById(floorplan_drawings, id, NOT_FOUND)
	if (Result.isError(found)) {
		return found
	}
	const owner = ownerOf(found.value)
	const scope = await ownerLocations(owner)
	const rows = await getDb()
		.select(linkLocationColumns)
		.from(locations)
		.where(
			and(
				scope === null
					? eq(locations.site_id, owner.site_id ?? 0)
					: inArray(locations.id, scope),
				scopeCondition(locations.tenant_id, scopeTenantIds),
			),
		)
		.orderBy(asc(locations.name), asc(locations.id))
	return Result.ok(rows)
}

/**
 * The drawn plan with its markers resolved. `scopeTenantIds` (a scoped
 * requester) leaves out markers whose object belongs to another tenant.
 */
export async function getDrawing(
	id: number,
	scopeTenantIds?: readonly number[],
): Promise<Result<FloorplanDrawingJson, Error>> {
	const found = await findById(floorplan_drawings, id, NOT_FOUND)
	if (Result.isError(found)) {
		return found
	}
	const row = found.value
	const [placementRows, reference, name, total, linked, building] = await Promise.all([
		getDb()
			.select({
				id: floorplan_drawing_placements.id,
				rack_id: floorplan_drawing_placements.rack_id,
				device_id: floorplan_drawing_placements.device_id,
				interface_id: floorplan_drawing_placements.interface_id,
				jack_id: floorplan_drawing_placements.jack_id,
				x: floorplan_drawing_placements.x,
				y: floorplan_drawing_placements.y,
				elevation: floorplan_drawing_placements.elevation,
				rack_units: rack_types.u_height,
				name: sql<string>`coalesce(${racks.name}, ${devices.name}, ${outletNameSql})`,
				status: devices.status,
				role_icon: device_roles.icon,
				...portColumns,
			})
			.from(floorplan_drawing_placements)
			.leftJoin(racks, eq(racks.id, floorplan_drawing_placements.rack_id))
			.leftJoin(rack_types, eq(rack_types.id, racks.rack_type_id))
			.leftJoin(devices, eq(devices.id, floorplan_drawing_placements.device_id))
			.leftJoin(device_roles, eq(device_roles.id, devices.device_role_id))
			.leftJoin(interfaces, placedPortJoin)
			.leftJoin(panel_jacks, eq(panel_jacks.id, floorplan_drawing_placements.jack_id))
			.leftJoin(portDevice, eq(portDevice.id, interfaces.device_id))
			.where(
				and(
					eq(floorplan_drawing_placements.drawing_id, id),
					scopeCondition(placementTenantSql, scopeTenantIds),
				),
			)
			.orderBy(asc(floorplan_drawing_placements.id)),
		row.reference_id === null
			? Promise.resolve(undefined)
			: findById(attachments, row.reference_id, 'Attachment not found'),
		drawingOwnerName(row),
		scopeTenantIds === undefined
			? Promise.resolve(0)
			: getDb().$count(
					floorplan_drawing_placements,
					eq(floorplan_drawing_placements.drawing_id, id),
				),
		linkedLocations(linkedLocationIds(row), scopeTenantIds),
		buildingOf(row),
	])
	const portsOf = await outletPorts(placementRows)
	const placements = placementRows.map(
		({ port_device_id, port_device_name, port_name, ...placement }) => ({
			...placement,
			port: portOf({ port_device_id, port_device_name, port_name }, portsOf(placement)),
		}),
	)
	const frame = row.reference_frame
	return Result.ok({
		id: row.id,
		site_id: row.site_id,
		location_id: row.location_id,
		owner_name: name,
		width: row.width,
		height: row.height,
		reference:
			reference && Result.isOk(reference) && frame
				? {
						attachment_id: reference.value.id,
						...frame,
						attachment: attachmentJson(reference.value),
					}
				: null,
		level: row.level,
		offset: { x: row.offset_x, y: row.offset_y },
		building,
		walls: row.walls,
		openings: row.openings,
		pillars: row.pillars,
		partitions: row.partitions,
		stairs: row.stairs,
		trays: row.trays,
		desks: row.desks,
		desk_groups: row.desk_groups,
		rooms: row.rooms,
		linked_locations: linked,
		placements,
		has_hidden_content: total > placements.length,
		updated_at: row.updated_at,
	})
}

/**
 * Racks, unracked devices and outlets the editor may place on a drawn plan:
 * in the owner's scope, visible, and not on another drawn plan. Those on
 * this plan are included. The same rules as the image plans'
 * `listPlanCandidates`, against the drawn plans' markers.
 */
export async function listDrawingCandidates(
	id: number,
	scopeTenantIds?: readonly number[],
): Promise<Result<FloorplanCandidateJson[], Error>> {
	const found = await findById(floorplan_drawings, id, NOT_FOUND)
	if (Result.isError(found)) {
		return found
	}
	const owner = ownerOf(found.value)
	const locationIds = await ownerLocations(owner)
	const free = or(
		isNull(floorplan_drawing_placements.id),
		eq(floorplan_drawing_placements.drawing_id, id),
	)
	const onThisPlan = eq(floorplan_drawing_placements.drawing_id, id)
	const rackRows = await getDb()
		.select({
			rack_id: racks.id,
			name: racks.name,
			location_id: racks.location_id,
			location_name: locations.name,
		})
		.from(racks)
		.leftJoin(locations, eq(locations.id, racks.location_id))
		.leftJoin(floorplan_drawing_placements, eq(floorplan_drawing_placements.rack_id, racks.id))
		.where(
			and(
				containedIn(racks, owner, locationIds),
				free,
				scopeCondition(racks.tenant_id, scopeTenantIds),
			),
		)
		.orderBy(asc(racks.name), asc(racks.id))
	const deviceRows = await getDb()
		.select({
			device_id: devices.id,
			name: devices.name,
			status: devices.status,
			role_icon: device_roles.icon,
			location_id: devices.location_id,
			location_name: locations.name,
		})
		.from(devices)
		.leftJoin(device_roles, eq(device_roles.id, devices.device_role_id))
		.leftJoin(locations, eq(locations.id, devices.location_id))
		.leftJoin(
			floorplan_drawing_placements,
			eq(floorplan_drawing_placements.device_id, devices.id),
		)
		.where(
			and(
				containedIn(devices, owner, locationIds),
				// Racked devices are managed in the rack view, not on plans.
				isNull(devices.rack_id),
				free,
				or(ne(devices.status, 'inactive'), onThisPlan),
				scopeCondition(devices.tenant_id, scopeTenantIds),
			),
		)
		.orderBy(asc(devices.name), asc(devices.id))
	const siteId = await siteOfOwner(owner)
	const portRows =
		siteId === null
			? []
			: await getDb()
					.select({
						port_id: interfaces.id,
						jack_id: interfaces.jack_id,
						name: outletNameSql,
						location_id: portDevice.location_id,
						location_name: locations.name,
						...portColumns,
					})
					.from(interfaces)
					.innerJoin(portDevice, eq(portDevice.id, interfaces.device_id))
					.leftJoin(panel_jacks, eq(panel_jacks.id, interfaces.jack_id))
					.leftJoin(locations, eq(locations.id, portDevice.location_id))
					.leftJoin(
						floorplan_drawing_placements,
						or(
							eq(floorplan_drawing_placements.interface_id, interfaces.id),
							eq(floorplan_drawing_placements.jack_id, interfaces.jack_id),
						),
					)
					.where(
						and(
							eq(interfaces.side, 'rear'),
							eq(interfaces.positions, 1),
							or(
								isNull(interfaces.jack_id),
								sql`${interfaces.id} = ${firstJackPort(interfaces.jack_id)}`,
							),
							eq(portDevice.site_id, siteId),
							free,
							or(sql`not ${panelLinkedSql}`, onThisPlan),
							or(
								sql`(${interfaces.jack_id} is null and ${interfaces.patched} = 1)`,
								sql`exists (select 1 from ${interfaces} jp where jp.jack_id = ${interfaces.jack_id} and jp.patched = 1)`,
								onThisPlan,
							),
							scopeCondition(portDevice.tenant_id, scopeTenantIds),
						),
					)
					.orderBy(asc(portDevice.name), asc(interfaces.id))
	const none = { rack_id: null, device_id: null, interface_id: null, jack_id: null, port: null }
	const outlets = portRows.map(({ port_id, ...row }) => ({
		...row,
		interface_id: row.jack_id === null ? port_id : null,
	}))
	const portsOf = await outletPorts(outlets)
	return Result.ok([
		...rackRows.map((row) => ({ ...none, ...row, status: null, role_icon: null })),
		...deviceRows.map((row) => ({ ...none, ...row })),
		...outlets.map(({ port_device_id, port_device_name, port_name, ...row }) => ({
			...none,
			...row,
			status: null,
			role_icon: null,
			port: portOf({ port_device_id, port_device_name, port_name }, portsOf(row)),
		})),
	])
}

/**
 * Checks a save against the owner: the reference image is one of the
 * owner's attachments; desks, desk groups and rooms link to visible locations in the
 * owner's scope (links already stored pass as they are, so a hidden or
 * deleted location never blocks a save); placed racks and devices exist, are visible, occur
 * once, lie in the owner's scope and are not on another drawn plan; placed
 * outlets pass `checkOutlets`.
 */
async function checkDrawingInput(
	stored: DrawingRow,
	input: FloorplanDrawingPut,
	scopeTenantIds: readonly number[] | undefined,
): Promise<Result<undefined, Error>> {
	const id = stored.id
	const owner = ownerOf(stored)
	if (input.reference) {
		const [image] = await getDb()
			.select({ site_id: attachments.site_id, location_id: attachments.location_id })
			.from(attachments)
			.where(eq(attachments.id, input.reference.attachment_id))
		const sameOwner =
			image !== undefined &&
			(owner.site_id !== undefined
				? image.site_id === owner.site_id
				: image.location_id === owner.location_id)
		if (!sameOwner) {
			return Result.err(
				new ValidationError('The reference image must be an image of the same owner'),
			)
		}
	}
	if (input.level !== null) {
		const stacked = await checkLevel(stored, input.level)
		if (Result.isError(stacked)) {
			return stacked
		}
	}
	const pick = (key: 'rack_id' | 'device_id' | 'interface_id' | 'jack_id'): number[] =>
		input.placements.flatMap((p) => (p[key] === undefined ? [] : [p[key]]))
	const rackIds = pick('rack_id')
	const deviceIds = pick('device_id')
	const interfaceIds = pick('interface_id')
	const jackIds = pick('jack_id')
	if ([rackIds, deviceIds, interfaceIds, jackIds].some((ids) => new Set(ids).size < ids.length)) {
		return Result.err(
			new ValidationError('Each rack, device or outlet can be placed only once'),
		)
	}
	const outlets = await checkOutlets(owner, interfaceIds, jackIds, scopeTenantIds)
	if (Result.isError(outlets)) {
		return outlets
	}
	const scope = await ownerLocations(owner)
	const kept = new Set(linkedLocationIds(stored))
	const linkIds = linkedLocationIds(input).filter((locationId) => !kept.has(locationId))
	if (linkIds.length > 0) {
		const rows = await getDb()
			.select({
				id: locations.id,
				name: locations.name,
				site_id: locations.site_id,
				tenant_id: locations.tenant_id,
			})
			.from(locations)
			.where(inArray(locations.id, linkIds))
		for (const locationId of linkIds) {
			const row = rows.find((location) => location.id === locationId)
			if (!row || !visibleTo(row.tenant_id, scopeTenantIds)) {
				return Result.err(new ValidationError(`Location #${locationId} not found`))
			}
			const contained =
				scope === null ? row.site_id === owner.site_id : scope.includes(row.id)
			if (!contained) {
				return Result.err(
					new ValidationError(
						`Location "${row.name}" is outside this floor plan's site or location`,
					),
				)
			}
		}
	}
	const placedRacks =
		rackIds.length === 0
			? []
			: await getDb()
					.select({
						id: racks.id,
						name: racks.name,
						tenant_id: racks.tenant_id,
						site_id: racks.site_id,
						location_id: racks.location_id,
					})
					.from(racks)
					.where(inArray(racks.id, rackIds))
	const placedDevices =
		deviceIds.length === 0
			? []
			: await getDb()
					.select({
						id: devices.id,
						name: devices.name,
						tenant_id: devices.tenant_id,
						site_id: devices.site_id,
						location_id: devices.location_id,
					})
					.from(devices)
					.where(inArray(devices.id, deviceIds))
	for (const [ids, rows, noun] of [
		[rackIds, placedRacks, 'Rack'],
		[deviceIds, placedDevices, 'Device'],
	] as const) {
		for (const objectId of ids) {
			const row = rows.find((object) => object.id === objectId)
			if (!row || !visibleTo(row.tenant_id, scopeTenantIds)) {
				return Result.err(new ValidationError(`${noun} #${objectId} not found`))
			}
			const contained =
				scope === null
					? row.site_id === owner.site_id
					: row.location_id !== null && scope.includes(row.location_id)
			if (!contained) {
				return Result.err(
					new ValidationError(
						`${noun} "${row.name ?? `#${row.id}`}" is outside this floor plan's site or location`,
					),
				)
			}
		}
	}
	const anyOf = (column: PgColumn, ids: number[]): SQL =>
		ids.length === 0 ? sql`false` : inArray(column, ids)
	const elsewhere = await getDb()
		.select({ id: floorplan_drawing_placements.id })
		.from(floorplan_drawing_placements)
		.where(
			and(
				ne(floorplan_drawing_placements.drawing_id, id),
				or(
					anyOf(floorplan_drawing_placements.rack_id, rackIds),
					anyOf(floorplan_drawing_placements.device_id, deviceIds),
					anyOf(floorplan_drawing_placements.interface_id, interfaceIds),
					anyOf(floorplan_drawing_placements.jack_id, jackIds),
				),
			),
		)
		.limit(1)
	return elsewhere.length > 0
		? Result.err(new ConflictError(ALREADY_PLACED))
		: Result.ok(undefined)
}

/**
 * A storey needs a building (the owner lies in another location or is a
 * top-level floor), and no other floor of that building may have it. Checks against every
 * sibling's plan, also those hidden from the requester.
 */
async function checkLevel(stored: DrawingRow, level: number): Promise<Result<undefined, Error>> {
	const building = await buildingOf(stored)
	if (building === null) {
		return Result.err(
			new ValidationError(
				'Only the plan of a floor or of a location inside another one can have a storey',
			),
		)
	}
	const [taken] = await getDb()
		.select({ name: locations.name })
		.from(floorplan_drawings)
		.innerJoin(locations, eq(locations.id, floorplan_drawings.location_id))
		.where(
			and(
				floorsOf(building),
				ne(floorplan_drawings.id, stored.id),
				eq(floorplan_drawings.level, level),
			),
		)
		.limit(1)
	return taken
		? Result.err(
				new ValidationError(
					`Storey ${level} of "${building.name}" is already taken by "${taken.name}"`,
				),
			)
		: Result.ok(undefined)
}

/** Ids of the plan's markers a scoped requester cannot see; none for a global one. */
async function hiddenPlacementIds(
	id: number,
	scopeTenantIds: readonly number[] | undefined,
): Promise<number[]> {
	if (scopeTenantIds === undefined) {
		return []
	}
	const rows = await getDb()
		.select({ id: floorplan_drawing_placements.id })
		.from(floorplan_drawing_placements)
		.leftJoin(racks, eq(racks.id, floorplan_drawing_placements.rack_id))
		.leftJoin(devices, eq(devices.id, floorplan_drawing_placements.device_id))
		.leftJoin(interfaces, placedPortJoin)
		.leftJoin(portDevice, eq(portDevice.id, interfaces.device_id))
		.where(
			and(
				eq(floorplan_drawing_placements.drawing_id, id),
				outsideScope(placementTenantSql, scopeTenantIds),
			),
		)
	return rows.map((row) => row.id)
}

/** The plan as stored, named after its owner, for the changelog. */
async function drawingSnapshot(row: DrawingRow): Promise<
	DrawingRow & {
		name: string
		placements: {
			rack_id: number | null
			device_id: number | null
			interface_id: number | null
			jack_id: number | null
			x: number
			y: number
			elevation: number
		}[]
	}
> {
	const placements = await getDb()
		.select({
			rack_id: floorplan_drawing_placements.rack_id,
			device_id: floorplan_drawing_placements.device_id,
			interface_id: floorplan_drawing_placements.interface_id,
			jack_id: floorplan_drawing_placements.jack_id,
			x: floorplan_drawing_placements.x,
			y: floorplan_drawing_placements.y,
			elevation: floorplan_drawing_placements.elevation,
		})
		.from(floorplan_drawing_placements)
		.where(eq(floorplan_drawing_placements.drawing_id, row.id))
		.orderBy(asc(floorplan_drawing_placements.id))
	return { ...row, name: await drawingOwnerName(row), placements }
}

/**
 * Replaces the sheet, reference image, drawn elements and markers in one
 * transaction with one changelog entry. Markers hidden from a scoped
 * requester stay unchanged. Returns the saved plan as `getDrawing`
 * resolves it for the requester.
 */
export async function putDrawing(
	id: number,
	input: FloorplanDrawingPut,
	scopeTenantIds?: readonly number[],
): Promise<Result<FloorplanDrawingJson, Error>> {
	const written = await tryWrite(
		() =>
			withTransaction(async (): Promise<Result<undefined, Error>> => {
				const [row] = await getDb()
					.select()
					.from(floorplan_drawings)
					.where(eq(floorplan_drawings.id, id))
					.for('update')
				if (!row) {
					return Result.err(new NotFoundError(NOT_FOUND))
				}
				const checked = await checkDrawingInput(row, input, scopeTenantIds)
				if (Result.isError(checked)) {
					return checked
				}
				const before = await drawingSnapshot(row)
				const hidden = await hiddenPlacementIds(id, scopeTenantIds)
				await getDb()
					.delete(floorplan_drawing_placements)
					.where(
						and(
							eq(floorplan_drawing_placements.drawing_id, id),
							hidden.length === 0
								? undefined
								: notInArray(floorplan_drawing_placements.id, hidden),
						),
					)
				if (input.placements.length > 0) {
					await getDb()
						.insert(floorplan_drawing_placements)
						.values(
							input.placements.map((placement) => ({
								drawing_id: id,
								rack_id: placement.rack_id ?? null,
								device_id: placement.device_id ?? null,
								interface_id: placement.interface_id ?? null,
								jack_id: placement.jack_id ?? null,
								x: placement.x,
								y: placement.y,
								elevation: placement.elevation,
							})),
						)
				}
				const reference: FloorplanReference | null = input.reference
				const [updated] = await getDb()
					.update(floorplan_drawings)
					.set({
						width: input.width,
						height: input.height,
						reference_id: reference?.attachment_id ?? null,
						reference_frame: reference
							? { x: reference.x, y: reference.y, width: reference.width }
							: null,
						level: input.level,
						offset_x: input.offset.x,
						offset_y: input.offset.y,
						walls: input.walls,
						openings: input.openings,
						pillars: input.pillars,
						partitions: input.partitions,
						stairs: input.stairs,
						trays: input.trays,
						desks: input.desks,
						desk_groups: input.desk_groups,
						rooms: input.rooms,
						updated_at: nowSeconds(),
					})
					.where(eq(floorplan_drawings.id, id))
					.returning()
				if (!updated) {
					return Result.err(new NotFoundError(NOT_FOUND))
				}
				await logUpdate(
					'floorplan_drawing',
					before,
					Result.ok(await drawingSnapshot(updated)),
				)
				return Result.ok(undefined)
			}),
		ALREADY_PLACED,
	)
	if (Result.isError(written)) {
		return written
	}
	if (Result.isError(written.value)) {
		return written.value
	}
	return getDrawing(id, scopeTenantIds)
}

/** Deletes a drawn plan with its markers; the reference image stays an attachment. */
export async function deleteDrawing(id: number): Promise<Result<undefined, Error>> {
	const found = await findById(floorplan_drawings, id, NOT_FOUND)
	if (Result.isError(found)) {
		return found
	}
	const before = await drawingSnapshot(found.value)
	await getDb().delete(floorplan_drawings).where(eq(floorplan_drawings.id, id))
	await logDelete('floorplan_drawing', before)
	return Result.ok(undefined)
}

/**
 * One page of the drawn plans whose owner matches the tenant filters,
 * ordered by `params.sort` (site by default), then site and owner name.
 * `search` matches the owner or site name. Marker counts leave out markers
 * outside `params.scopeTenantIds`, like `getDrawing`.
 */
export async function listDrawings(
	params: TenantFilterParams &
		ListParams & {
			sort: 'owner' | 'type' | 'site' | 'tenant'
			order: 'asc' | 'desc'
		},
): Promise<Page<FloorplanDrawingListJson>> {
	const ownerSite = sql`coalesce(${floorplan_drawings.site_id}, ${locations.site_id})`
	const siteName = sql<string>`(select s.name from ${sites} s where s.id = ${ownerSite})`
	const ownerTenant = sql<number | null>`coalesce(${sites.tenant_id}, ${locations.tenant_id})`
	const ownerName = sql<string>`coalesce(${sites.name}, ${locations.name})`
	const where = and(
		searchCondition(params.search, [ownerName, siteName]),
		...tenantConditions(ownerTenant, params),
	)
	const base = getDb()
		.select({
			id: floorplan_drawings.id,
			site_id: floorplan_drawings.site_id,
			location_id: floorplan_drawings.location_id,
			owner_name: ownerName,
			location_type: locations.type,
			site_name: siteName,
			tenant_id: ownerTenant,
			tenant_name: tenants.name,
			walls: sql<number>`jsonb_array_length(${floorplan_drawings.walls})`,
		})
		.from(floorplan_drawings)
		.leftJoin(sites, eq(sites.id, floorplan_drawings.site_id))
		.leftJoin(locations, eq(locations.id, floorplan_drawings.location_id))
		.leftJoin(tenants, eq(tenants.id, ownerTenant))
		.where(where)
	const rows = await base
		.orderBy(
			orderOf(
				{
					owner: ownerName,
					type: locations.type,
					site: siteName,
					tenant: tenants.name,
				}[params.sort],
				params.order,
			),
			asc(siteName),
			asc(ownerName),
			asc(floorplan_drawings.id),
		)
		.limit(params.limit)
		.offset(offsetOf(params))
	const [{ total }] = await getDb()
		.select({ total: count() })
		.from(floorplan_drawings)
		.leftJoin(sites, eq(sites.id, floorplan_drawings.site_id))
		.leftJoin(locations, eq(locations.id, floorplan_drawings.location_id))
		.where(where)
	if (rows.length === 0) {
		return pageOf([], total, params)
	}
	const counts = await getDb()
		.select({ id: floorplan_drawing_placements.drawing_id, n: count() })
		.from(floorplan_drawing_placements)
		.leftJoin(racks, eq(racks.id, floorplan_drawing_placements.rack_id))
		.leftJoin(devices, eq(devices.id, floorplan_drawing_placements.device_id))
		.leftJoin(interfaces, placedPortJoin)
		.leftJoin(portDevice, eq(portDevice.id, interfaces.device_id))
		.where(
			and(
				inArray(
					floorplan_drawing_placements.drawing_id,
					rows.map((row) => row.id),
				),
				scopeCondition(placementTenantSql, params.scopeTenantIds),
			),
		)
		.groupBy(floorplan_drawing_placements.drawing_id)
	const placements = new Map(counts.map((row) => [row.id, row.n]))
	return pageOf(
		rows.map((row) => ({ ...row, placements: placements.get(row.id) ?? 0 })),
		total,
		params,
	)
}
