/**
 * Drawn floor plans (v2): a sheet in centimeters per site or location with
 * walls, doors and windows drawn on it, optionally over a reference image
 * (an attachment of the same owner), and rack, device and outlet markers.
 *
 * Walls and openings are one JSON document each, replaced with every save.
 * Markers reference racks, devices, rear ports and jacks, so they live in
 * `floorplan_drawing_placements`; each object sits on at most one drawn
 * plan. Like the image plans (`attachments.ts`), markers outside a scoped
 * requester's tenants are left out of reads and kept as they are on save.
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
import type { PgColumn } from 'drizzle-orm/pg-core'
import type {
	FloorplanCandidateJson,
	FloorplanDrawingCreate,
	FloorplanDrawingJson,
	FloorplanDrawingListJson,
	FloorplanDrawingPut,
	FloorplanDrawingRefJson,
	FloorplanReference,
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
	const [placementRows, reference, name, total] = await Promise.all([
		getDb()
			.select({
				id: floorplan_drawing_placements.id,
				rack_id: floorplan_drawing_placements.rack_id,
				device_id: floorplan_drawing_placements.device_id,
				interface_id: floorplan_drawing_placements.interface_id,
				jack_id: floorplan_drawing_placements.jack_id,
				x: floorplan_drawing_placements.x,
				y: floorplan_drawing_placements.y,
				name: sql<string>`coalesce(${racks.name}, ${devices.name}, ${outletNameSql})`,
				status: devices.status,
				role_icon: device_roles.icon,
				...portColumns,
			})
			.from(floorplan_drawing_placements)
			.leftJoin(racks, eq(racks.id, floorplan_drawing_placements.rack_id))
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
		walls: row.walls,
		openings: row.openings,
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
 * owner's attachments; placed racks and devices exist, are visible, occur
 * once, lie in the owner's scope and are not on another drawn plan; placed
 * outlets pass `checkOutlets`.
 */
async function checkDrawingInput(
	id: number,
	owner: AttachmentOwner,
	input: FloorplanDrawingPut,
	scopeTenantIds: readonly number[] | undefined,
): Promise<Result<undefined, Error>> {
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
		})
		.from(floorplan_drawing_placements)
		.where(eq(floorplan_drawing_placements.drawing_id, row.id))
		.orderBy(asc(floorplan_drawing_placements.id))
	return { ...row, name: await drawingOwnerName(row), placements }
}

/**
 * Replaces the sheet, reference image, walls, openings and markers in one
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
				const checked = await checkDrawingInput(id, ownerOf(row), input, scopeTenantIds)
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
						walls: input.walls,
						openings: input.openings,
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
