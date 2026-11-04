/**
 * Attachments: PNG / JPEG images owned by one site, location or rack. The row
 * holds the metadata, the file lives on disk (`storage.ts`). A new file is
 * written (tmp, then renamed) before its row; a failed insert removes it
 * again. A delete removes the row first and the file after the commit, so a
 * crash leaves at worst an orphan file, which the startup sweep removes.
 */
import { Result } from 'better-result'
import {
	and,
	asc,
	count,
	eq,
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
	AttachmentJson,
	AttachmentMime,
	AttachmentUpdate,
	FloorplanCandidateJson,
	FloorplanImpactJson,
	FloorplanJson,
	FloorplanLinkJson,
	FloorplanLinksQuery,
	FloorplanListJson,
	FloorplanOutletJson,
	FloorplanOutletPortJson,
	FloorplanPortJson,
	FloorplanPut,
} from 'shared/src/schemas'
import {
	attachments,
	cables,
	device_roles,
	devices,
	floorplan_areas,
	floorplan_calibrations,
	floorplan_placements,
	interfaces,
	locations,
	panel_jacks,
	racks,
	sites,
	tenants,
} from '../schema'
import { buildChildrenMap } from '../services/hierarchy'
import {
	attachmentFileName,
	listAttachmentFiles,
	removeAttachmentFiles,
	removeStoredFile,
	writeAttachmentFile,
} from '../storage'
import { IMAGE_EXTENSIONS, readImageInfo } from '../util/image'
import { nowSeconds } from '../util/time'
import { logCreate, logDelete, logUpdate } from './changelog'
import { getDb, withTransaction } from './connection'
import { toInterfaceJson } from './devices'
import { ConflictError, FloorplanImpactError, NotFoundError, ValidationError } from './errors'
import {
	checkExists,
	findById,
	inScope,
	insertedId,
	inTenants,
	isPatchEmpty,
	type ListParams,
	offsetOf,
	type Page,
	pageOf,
	pickDefined,
	scopeCondition,
	searchCondition,
	type TenantFilterParams,
	tenantConditions,
	tryWrite,
} from './list'

export type AttachmentRow = typeof attachments.$inferSelect
type FloorplanAreaRow = typeof floorplan_areas.$inferSelect
type FloorplanPlacementRow = typeof floorplan_placements.$inferSelect

/** Owner of an attachment: exactly one of the three ids is set. */
export interface AttachmentOwner {
	site_id?: number
	location_id?: number
	rack_id?: number
}

/** Uploaded file: the client's file name and the raw bytes. */
export interface AttachmentUpload {
	name: string
	bytes: Uint8Array
}

const NOT_FOUND = 'Attachment not found'
const FLOORPLAN_TAKEN = 'Another attachment is already marked as the floor plan'
const NOT_MARKED = 'Only the marked floor plan can hold areas and markers'
const NO_RACK_FLOORPLAN = 'Rack images cannot be marked as the floor plan'
const ALREADY_PLACED = 'A rack, device or outlet is already placed on another floor plan'

/** Panel device of a placed outlet (rear port); `devices` itself is the placed device. */
const portDevice = alias(devices, 'port_device')

/** First port of a jack: it stands for the jack's panel, location and tenant. */
function firstJackPort(jackId: SQL | PgColumn): SQL<number | null> {
	return sql<
		number | null
	>`(select min(jp.id) from ${interfaces} jp where jp.jack_id = ${jackId})`
}

/**
 * Joins `interfaces` to a placement's outlet: the placed port, or the
 * first port of the placed jack (its ports share panel and location).
 */
const placedPortJoin: SQL = sql`${interfaces.id} = coalesce(${floorplan_placements.interface_id}, ${firstJackPort(floorplan_placements.jack_id)})`

/** An outlet's own location (`interfaces.location_id`), apart from its panel's. */
const outletLocation = alias(locations, 'outlet_location')

/** Site an outlet lies in: its own location's, else its panel's. */
const outletSiteSql: SQL<number | null> = sql<
	number | null
>`coalesce(${outletLocation.site_id}, ${portDevice.site_id})`

/** Tenant of a placement's object: its rack, device or outlet panel. */
const placementTenantSql: SQL<number | null> = sql<
	number | null
>`coalesce(${racks.tenant_id}, ${devices.tenant_id}, ${portDevice.tenant_id})`

/** An outlet: a single rear port, or a jack of several. */
interface OutletKey {
	interface_id: number | null
	jack_id: number | null
}

/** Ports of each outlet in `keys`, in port order (`FloorplanPortJson.ports`). */
async function outletPorts(
	keys: OutletKey[],
): Promise<(key: OutletKey) => FloorplanOutletPortJson[]> {
	const ids = keys.flatMap((key) => (key.jack_id === null ? (key.interface_id ?? []) : []))
	const jackIds = keys.flatMap((key) => key.jack_id ?? [])
	const rows =
		ids.length === 0 && jackIds.length === 0
			? []
			: await getDb()
					.select({
						id: interfaces.id,
						name: interfaces.name,
						connected: interfaces.connected,
						jack_id: interfaces.jack_id,
					})
					.from(interfaces)
					.where(
						or(
							ids.length === 0 ? undefined : inArray(interfaces.id, ids),
							jackIds.length === 0 ? undefined : inArray(interfaces.jack_id, jackIds),
						),
					)
					.orderBy(asc(interfaces.id))
	const toPort = (row: (typeof rows)[number]): FloorplanOutletPortJson => ({
		id: row.id,
		name: row.name,
		connected: row.connected === 1,
	})
	return (key: OutletKey): FloorplanOutletPortJson[] =>
		key.jack_id !== null
			? rows.filter((row) => row.jack_id === key.jack_id).map(toPort)
			: rows.filter((row) => row.id === key.interface_id).map(toPort)
}

/** Outlet details of a placement or candidate row, or `null` when it is no outlet. */
function portOf(
	row: {
		port_device_id: number | null
		port_device_name: string | null
		port_name: string | null
	},
	ports: FloorplanOutletPortJson[],
): FloorplanPortJson | null {
	return row.port_device_id === null
		? null
		: {
				device_id: row.port_device_id,
				device_name: row.port_device_name ?? '',
				name: row.port_name ?? '',
				connected: ports.some((port) => port.connected),
				ports,
			}
}

/** Name of an outlet with `panel_jacks` joined to it: its jack's, else its port's. */
const outletPortNameSql: SQL<string> = sql<string>`coalesce(${panel_jacks.name}, ${interfaces.name})`

/** `PP-A / 12`: an outlet's label on plans and in palettes. */
const outletNameSql: SQL<string> = sql<string>`${portDevice.name} || ' / ' || ${outletPortNameSql}`

/** Outlet columns selected alongside a placement or candidate (`portOf`). */
const portColumns: {
	port_device_id: typeof portDevice.id
	port_device_name: typeof portDevice.name
	port_name: SQL<string>
} = {
	port_device_id: portDevice.id,
	port_device_name: portDevice.name,
	port_name: outletPortNameSql,
}

/** Stored files are `<uuid>.<ext>`, plus `<uuid>.tmp` while being written. */
const STORED_FILE = new RegExp(
	`^[0-9a-f-]{36}\\.(?:tmp|${Object.values(IMAGE_EXTENSIONS).join('|')})$`,
)

function toJson(row: AttachmentRow): AttachmentJson {
	return { ...row, is_floorplan: row.is_floorplan !== 0 }
}

function ownerCondition(owner: AttachmentOwner): SQL {
	if (owner.site_id !== undefined) {
		return eq(attachments.site_id, owner.site_id)
	}
	if (owner.location_id !== undefined) {
		return eq(attachments.location_id, owner.location_id)
	}
	if (owner.rack_id !== undefined) {
		return eq(attachments.rack_id, owner.rack_id)
	}
	return sql`false`
}

/** 404 when the owning site, location or rack does not exist. */
async function checkOwner(owner: AttachmentOwner): Promise<Result<undefined, Error>> {
	if (owner.site_id !== undefined) {
		return checkExists(sites, owner.site_id, 'Site not found')
	}
	if (owner.rack_id !== undefined) {
		return checkExists(racks, owner.rack_id, 'Rack not found')
	}
	return checkExists(locations, owner.location_id, 'Location not found')
}

/**
 * Display name of an upload: the base name without control characters,
 * capped in length. Falls back to `image.<ext>` when nothing is left.
 */
function cleanFilename(name: string, mime: AttachmentMime): string {
	const base = (name.split(/[/\\]/).pop() ?? '')
		// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping them is the point
		.replace(/[\u0000-\u001f\u007f]/g, '')
		.trim()
		.slice(0, 200)
	return base || `image.${IMAGE_EXTENSIONS[mime]}`
}

/** Checks the bytes and stores them under a fresh key; returns the row fields. */
async function storeUpload(
	upload: AttachmentUpload,
): Promise<
	Result<
		Pick<
			AttachmentRow,
			'filename' | 'mime' | 'size_bytes' | 'width_px' | 'height_px' | 'storage_key'
		>,
		Error
	>
> {
	const info = readImageInfo(upload.bytes)
	if (Result.isError(info)) {
		return info
	}
	const storageKey = crypto.randomUUID()
	const written = await writeAttachmentFile(storageKey, info.value.mime, upload.bytes)
	if (Result.isError(written)) {
		return written
	}
	return Result.ok({
		filename: cleanFilename(upload.name, info.value.mime),
		mime: info.value.mime,
		size_bytes: upload.bytes.length,
		width_px: info.value.width,
		height_px: info.value.height,
		storage_key: storageKey,
	})
}

/** Attachments of one owner, oldest first. */
export async function listAttachments(
	owner: AttachmentOwner,
): Promise<Result<AttachmentJson[], Error>> {
	const found = await checkOwner(owner)
	if (Result.isError(found)) {
		return found
	}
	const rows = await getDb()
		.select()
		.from(attachments)
		.where(ownerCondition(owner))
		.orderBy(asc(attachments.created_at), asc(attachments.id))
	return Result.ok(rows.map(toJson))
}

/** Raw row including the storage key (file serving, replace, delete). */
export function getAttachmentRow(id: number): Promise<Result<AttachmentRow, Error>> {
	return findById(attachments, id, NOT_FOUND)
}

export async function getAttachment(id: number): Promise<Result<AttachmentJson, Error>> {
	return (await getAttachmentRow(id)).map(toJson)
}

export async function createAttachment(
	owner: AttachmentOwner,
	upload: AttachmentUpload,
	input: { description?: string; created_by: number | null },
): Promise<Result<AttachmentJson, Error>> {
	const found = await checkOwner(owner)
	if (Result.isError(found)) {
		return found
	}
	const stored = await storeUpload(upload)
	if (Result.isError(stored)) {
		return stored
	}
	const id = await tryWrite(async () =>
		insertedId(
			await getDb()
				.insert(attachments)
				.values({
					...stored.value,
					site_id: owner.site_id ?? null,
					location_id: owner.location_id ?? null,
					rack_id: owner.rack_id ?? null,
					description: input.description || null,
					created_at: nowSeconds(),
					created_by: input.created_by,
				})
				.returning({ id: attachments.id }),
		),
	)
	if (Result.isError(id)) {
		await removeAttachmentFiles([stored.value])
		return id
	}
	return await logCreate('attachment', await getAttachment(id.value))
}

/**
 * Replaces the image of an attachment. Areas and placements use normalized
 * coordinates and stay as they are. The new file gets a new storage key;
 * the old file is removed once the row points at the new one.
 */
export async function replaceAttachmentFile(
	id: number,
	upload: AttachmentUpload,
): Promise<Result<AttachmentJson, Error>> {
	const current = await getAttachmentRow(id)
	if (Result.isError(current)) {
		return current
	}
	const stored = await storeUpload(upload)
	if (Result.isError(stored)) {
		return stored
	}
	const written = await tryWrite(() =>
		getDb().update(attachments).set(stored.value).where(eq(attachments.id, id)),
	)
	if (Result.isError(written)) {
		await removeAttachmentFiles([stored.value])
		return written
	}
	await removeAttachmentFiles([current.value])
	return await logUpdate('attachment', toJson(current.value), await getAttachment(id))
}

/**
 * Clears the areas and placements of the given attachments. Runs on the
 * caller's `getDb()` (its transaction).
 */
async function clearPlans(ids: number[]): Promise<void> {
	if (ids.length === 0) {
		return
	}
	await getDb().delete(floorplan_areas).where(inArray(floorplan_areas.attachment_id, ids))
	await getDb()
		.delete(floorplan_placements)
		.where(inArray(floorplan_placements.attachment_id, ids))
	await getDb()
		.delete(floorplan_calibrations)
		.where(inArray(floorplan_calibrations.attachment_id, ids))
}

/**
 * Updates the description and the floor-plan mark. Areas and placements
 * exist only on the marked attachment, so in one transaction marking
 * unmarks the owner's previous floor plan and clears its plan, and
 * unmarking clears this attachment's plan. The client confirms that loss
 * beforehand. Rack images cannot be marked.
 */
export async function updateAttachment(
	id: number,
	input: AttachmentUpdate,
): Promise<Result<AttachmentJson, Error>> {
	const current = await getAttachmentRow(id)
	if (Result.isError(current)) {
		return current
	}
	const patch: Partial<AttachmentRow> = pickDefined(input, ['description'])
	if (input.is_floorplan !== undefined) {
		patch.is_floorplan = input.is_floorplan ? 1 : 0
	}
	if (isPatchEmpty(patch)) {
		return Result.ok(toJson(current.value))
	}
	if (input.is_floorplan === true && current.value.rack_id !== null) {
		return Result.err(new ValidationError(NO_RACK_FLOORPLAN))
	}
	const owner = ownerOf(current.value)
	const written = await tryWrite(
		() =>
			withTransaction(async (): Promise<Result<AttachmentJson, Error>> => {
				// Serialize mark changes per owner, including when there is no
				// marked attachment yet. Re-read only after acquiring the lock.
				if (owner.site_id !== undefined) {
					await getDb()
						.select({ id: sites.id })
						.from(sites)
						.where(eq(sites.id, owner.site_id))
						.for('update')
				} else if (owner.location_id !== undefined) {
					await getDb()
						.select({ id: locations.id })
						.from(locations)
						.where(eq(locations.id, owner.location_id))
						.for('update')
				}
				const [row] = await getDb()
					.select()
					.from(attachments)
					.where(eq(attachments.id, id))
					.for('update')
				if (!row) {
					return Result.err(new NotFoundError(NOT_FOUND))
				}
				if (input.is_floorplan === true) {
					const unmarked = await getDb()
						.update(attachments)
						.set({ is_floorplan: 0 })
						.where(
							and(
								ownerCondition(owner),
								ne(attachments.id, id),
								eq(attachments.is_floorplan, 1),
							),
						)
						.returning()
					await clearPlans(unmarked.map((other) => other.id))
					for (const other of unmarked) {
						await logUpdate(
							'attachment',
							toJson({ ...other, is_floorplan: 1 }),
							Result.ok(toJson(other)),
						)
					}
				}
				if (input.is_floorplan === false) {
					await clearPlans([id])
				}
				const [updated] = await getDb()
					.update(attachments)
					.set(patch)
					.where(eq(attachments.id, id))
					.returning()
				return updated
					? logUpdate('attachment', toJson(row), Result.ok(toJson(updated)))
					: Result.err(new NotFoundError(NOT_FOUND))
			}),
		FLOORPLAN_TAKEN,
	)
	return Result.isError(written) ? written : written.value
}

/**
 * Areas and placements of an attachment with their targets and objects
 * resolved. `scopeTenantIds` (a scoped requester) leaves out areas whose
 * target and placements whose rack or device belong to another tenant.
 * An unmarked attachment has an empty plan.
 */
export async function getPlan(
	id: number,
	scopeTenantIds?: readonly number[],
): Promise<Result<FloorplanJson, Error>> {
	const found = await getAttachmentRow(id)
	if (Result.isError(found)) {
		return found
	}
	if (found.value.is_floorplan === 0) {
		return Result.ok({
			attachment_id: id,
			areas: [],
			placements: [],
			scale: null,
			origin: null,
			has_hidden_content: false,
		})
	}
	const areaTenant = sql<number | null>`coalesce(${sites.tenant_id}, ${locations.tenant_id})`
	const targetPlan = alias(attachments, 'target_plan')
	const areas = await getDb()
		.select({
			id: floorplan_areas.id,
			site_id: floorplan_areas.site_id,
			location_id: floorplan_areas.location_id,
			label: floorplan_areas.label,
			points: floorplan_areas.points,
			target_name: sql<string>`coalesce(${sites.name}, ${locations.name})`,
			target_type: locations.type,
			target_plan_id: targetPlan.id,
		})
		.from(floorplan_areas)
		.leftJoin(sites, eq(sites.id, floorplan_areas.site_id))
		.leftJoin(locations, eq(locations.id, floorplan_areas.location_id))
		.leftJoin(
			targetPlan,
			and(
				eq(targetPlan.is_floorplan, 1),
				or(
					eq(targetPlan.site_id, floorplan_areas.site_id),
					eq(targetPlan.location_id, floorplan_areas.location_id),
				),
			),
		)
		.where(
			and(eq(floorplan_areas.attachment_id, id), scopeCondition(areaTenant, scopeTenantIds)),
		)
		.orderBy(asc(floorplan_areas.id))
	const placementRows = await getDb()
		.select({
			id: floorplan_placements.id,
			rack_id: floorplan_placements.rack_id,
			device_id: floorplan_placements.device_id,
			interface_id: floorplan_placements.interface_id,
			jack_id: floorplan_placements.jack_id,
			x: floorplan_placements.x,
			y: floorplan_placements.y,
			name: sql<string>`coalesce(${racks.name}, ${devices.name}, ${outletNameSql})`,
			status: devices.status,
			role_icon: device_roles.icon,
			...portColumns,
		})
		.from(floorplan_placements)
		.leftJoin(racks, eq(racks.id, floorplan_placements.rack_id))
		.leftJoin(devices, eq(devices.id, floorplan_placements.device_id))
		.leftJoin(device_roles, eq(device_roles.id, devices.device_role_id))
		.leftJoin(interfaces, placedPortJoin)
		.leftJoin(panel_jacks, eq(panel_jacks.id, floorplan_placements.jack_id))
		.leftJoin(portDevice, eq(portDevice.id, interfaces.device_id))
		.where(
			and(
				eq(floorplan_placements.attachment_id, id),
				scopeCondition(placementTenantSql, scopeTenantIds),
			),
		)
		.orderBy(asc(floorplan_placements.id))
	const portsOf = await outletPorts(placementRows)
	const placements = placementRows.map(
		({ port_device_id, port_device_name, port_name, ...row }) => ({
			...row,
			port: portOf({ port_device_id, port_device_name, port_name }, portsOf(row)),
		}),
	)
	// A scoped editor must still be warned before a mark change clears
	// hidden content. Reveal only its existence, never its targets or counts.
	const hasHiddenContent =
		scopeTenantIds !== undefined &&
		((await getDb().$count(floorplan_areas, eq(floorplan_areas.attachment_id, id))) >
			areas.length ||
			(await getDb().$count(
				floorplan_placements,
				eq(floorplan_placements.attachment_id, id),
			)) > placements.length)
	const calibration = await planCalibration(id)
	return Result.ok({
		attachment_id: id,
		areas,
		placements,
		...calibration,
		has_hidden_content: hasHiddenContent,
	})
}

/** Scale and origin of a plan; `null` each while unset. */
async function planCalibration(id: number): Promise<Pick<FloorplanJson, 'scale' | 'origin'>> {
	const [row] = await getDb()
		.select({ scale: floorplan_calibrations.scale, origin: floorplan_calibrations.origin })
		.from(floorplan_calibrations)
		.where(eq(floorplan_calibrations.attachment_id, id))
	return { scale: row?.scale ?? null, origin: row?.origin ?? null }
}

function ownerOf(row: AttachmentRow): AttachmentOwner {
	return {
		site_id: row.site_id ?? undefined,
		location_id: row.location_id ?? undefined,
		rack_id: row.rack_id ?? undefined,
	}
}

/**
 * Locations a plan owner contains: `null` for a site (all of it), else the
 * location itself and its descendants.
 */
async function ownerLocations(owner: AttachmentOwner): Promise<number[] | null> {
	if (owner.location_id === undefined) {
		return null
	}
	const ids = [owner.location_id]
	const [root] = await getDb()
		.select({ site_id: locations.site_id })
		.from(locations)
		.where(eq(locations.id, owner.location_id))
	if (!root) {
		return ids
	}
	const children = buildChildrenMap(
		await getDb()
			.select({ id: locations.id, parent_id: locations.parent_id })
			.from(locations)
			.where(eq(locations.site_id, root.site_id)),
	)
	for (let i = 0; i < ids.length; i++) {
		ids.push(...(children.get(ids[i] as number) ?? []))
	}
	return ids
}

/** Rack or device columns lying in the owner's scope (see `ownerLocations`). */
function containedIn(
	columns: { site_id: PgColumn; location_id: PgColumn },
	owner: AttachmentOwner,
	locationIds: number[] | null,
): SQL {
	return locationIds === null
		? eq(columns.site_id, owner.site_id ?? 0)
		: inArray(columns.location_id, locationIds)
}

/** SQL twin of `!visibleTo`: shared (`NULL`) tenants lie outside too. */
function outsideScope(tenant: SQL, scopeTenantIds: readonly number[]): SQL {
	return sql`not coalesce(${inTenants(tenant, scopeTenantIds)}, false)`
}

function visibleTo(tenant: number | null, scopeTenantIds: readonly number[] | undefined): boolean {
	return inScope(tenant, scopeTenantIds)
}

/** Racks, unracked devices and outlets the editor may place on a plan (`FloorplanCandidateJson`). */
export async function listPlanCandidates(
	id: number,
	scopeTenantIds?: readonly number[],
): Promise<Result<FloorplanCandidateJson[], Error>> {
	const found = await getAttachmentRow(id)
	if (Result.isError(found)) {
		return found
	}
	const owner = ownerOf(found.value)
	const locationIds = await ownerLocations(owner)
	// Unplaced, or placed on this plan.
	const free = or(isNull(floorplan_placements.id), eq(floorplan_placements.attachment_id, id))
	const rackRows = await getDb()
		.select({
			rack_id: racks.id,
			name: racks.name,
			location_id: racks.location_id,
			location_name: locations.name,
		})
		.from(racks)
		.leftJoin(locations, eq(locations.id, racks.location_id))
		.leftJoin(floorplan_placements, eq(floorplan_placements.rack_id, racks.id))
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
		.leftJoin(floorplan_placements, eq(floorplan_placements.device_id, devices.id))
		.where(
			and(
				containedIn(devices, owner, locationIds),
				// Racked devices are managed in the rack view, not on plans.
				isNull(devices.rack_id),
				free,
				scopeCondition(devices.tenant_id, scopeTenantIds),
			),
		)
		.orderBy(asc(devices.name), asc(devices.id))
	// Outlets: single-position rear ports (a multi-position rear port is a
	// trunk, not an outlet) in the owner's site: by their own location, else
	// by their panel's. On a location's plan, an outlet with a location of
	// its own must lie in the owner's scope. A jack is one outlet, its
	// first port's row stands for it.
	const siteId = await siteOfOwner(owner)
	const portRows =
		siteId === null
			? []
			: await getDb()
					.select({
						port_id: interfaces.id,
						jack_id: interfaces.jack_id,
						name: outletNameSql,
						location_id: sql<
							number | null
						>`coalesce(${interfaces.location_id}, ${portDevice.location_id})`,
						location_name: sql<
							string | null
						>`coalesce(${outletLocation.name}, ${locations.name})`,
						...portColumns,
					})
					.from(interfaces)
					.innerJoin(portDevice, eq(portDevice.id, interfaces.device_id))
					.leftJoin(panel_jacks, eq(panel_jacks.id, interfaces.jack_id))
					.leftJoin(locations, eq(locations.id, portDevice.location_id))
					.leftJoin(outletLocation, eq(outletLocation.id, interfaces.location_id))
					.leftJoin(
						floorplan_placements,
						or(
							eq(floorplan_placements.interface_id, interfaces.id),
							eq(floorplan_placements.jack_id, interfaces.jack_id),
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
							sql`${outletSiteSql} = ${siteId}`,
							locationIds === null
								? undefined
								: or(
										isNull(interfaces.location_id),
										inArray(interfaces.location_id, locationIds),
									),
							free,
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

/** Site of a plan owner: the site itself, or the site of the owning location. */
async function siteOfOwner(owner: AttachmentOwner): Promise<number | null> {
	if (owner.site_id !== undefined) {
		return owner.site_id
	}
	const [row] = await getDb()
		.select({ site_id: locations.site_id })
		.from(locations)
		.where(eq(locations.id, owner.location_id ?? 0))
	return row?.site_id ?? null
}

/**
 * Checks a plan save against its owner: area targets exist, are visible,
 * are not the owner and occur once; placed racks and devices exist, are
 * visible, occur once, lie in the owner's scope and are not placed on
 * another plan. Missing and invisible objects get the same message.
 */
async function checkPlanInput(
	id: number,
	owner: AttachmentOwner,
	input: FloorplanPut,
	scopeTenantIds: readonly number[] | undefined,
): Promise<Result<undefined, Error>> {
	const siteIds = input.areas.flatMap((area) =>
		area.site_id === undefined ? [] : [area.site_id],
	)
	const locationIds = input.areas.flatMap((area) =>
		area.location_id === undefined ? [] : [area.location_id],
	)
	if (new Set(siteIds).size < siteIds.length || new Set(locationIds).size < locationIds.length) {
		return Result.err(new ValidationError('Each site or location can be linked only once'))
	}
	if (
		(owner.site_id !== undefined && siteIds.includes(owner.site_id)) ||
		(owner.location_id !== undefined && locationIds.includes(owner.location_id))
	) {
		return Result.err(new ValidationError('An area cannot link to the floor plan itself'))
	}
	const targetSites =
		siteIds.length === 0
			? []
			: await getDb()
					.select({ id: sites.id, tenant_id: sites.tenant_id })
					.from(sites)
					.where(inArray(sites.id, siteIds))
	const targetLocations =
		locationIds.length === 0
			? []
			: await getDb()
					.select({ id: locations.id, tenant_id: locations.tenant_id })
					.from(locations)
					.where(inArray(locations.id, locationIds))
	for (const [ids, rows, noun] of [
		[siteIds, targetSites, 'Site'],
		[locationIds, targetLocations, 'Location'],
	] as const) {
		for (const targetId of ids) {
			const row = rows.find((target) => target.id === targetId)
			if (!row || !visibleTo(row.tenant_id, scopeTenantIds)) {
				return Result.err(new ValidationError(`${noun} #${targetId} not found`))
			}
		}
	}

	const rackIds = input.placements.flatMap((p) => (p.rack_id === undefined ? [] : [p.rack_id]))
	const deviceIds = input.placements.flatMap((p) =>
		p.device_id === undefined ? [] : [p.device_id],
	)
	const interfaceIds = input.placements.flatMap((p) =>
		p.interface_id === undefined ? [] : [p.interface_id],
	)
	const jackIds = input.placements.flatMap((p) => (p.jack_id === undefined ? [] : [p.jack_id]))
	if (
		new Set(rackIds).size < rackIds.length ||
		new Set(deviceIds).size < deviceIds.length ||
		new Set(interfaceIds).size < interfaceIds.length ||
		new Set(jackIds).size < jackIds.length
	) {
		return Result.err(
			new ValidationError('Each rack, device or outlet can be placed only once'),
		)
	}
	const scope = await ownerLocations(owner)
	const outlets = await checkOutlets(owner, scope, interfaceIds, jackIds, scopeTenantIds)
	if (Result.isError(outlets)) {
		return outlets
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
	const elsewhere = await getDb()
		.select({ id: floorplan_placements.id })
		.from(floorplan_placements)
		.where(
			and(
				ne(floorplan_placements.attachment_id, id),
				or(
					rackIds.length === 0
						? sql`false`
						: inArray(floorplan_placements.rack_id, rackIds),
					deviceIds.length === 0
						? sql`false`
						: inArray(floorplan_placements.device_id, deviceIds),
					interfaceIds.length === 0
						? sql`false`
						: inArray(floorplan_placements.interface_id, interfaceIds),
					jackIds.length === 0
						? sql`false`
						: inArray(floorplan_placements.jack_id, jackIds),
				),
			),
		)
		.limit(1)
	return elsewhere.length > 0
		? Result.err(new ConflictError(ALREADY_PLACED))
		: Result.ok(undefined)
}

/**
 * Placed outlets exist, are visible, are single-position rear ports in no
 * jack, or jacks, and lie in the owner's site (`outletSiteSql`); on a
 * location's plan an outlet with a location of its own must lie in
 * `scope`. Missing and invisible ports and jacks get the same message.
 */
async function checkOutlets(
	owner: AttachmentOwner,
	scope: number[] | null,
	interfaceIds: number[],
	jackIds: number[],
	scopeTenantIds: readonly number[] | undefined,
): Promise<Result<undefined, Error>> {
	if (interfaceIds.length === 0 && jackIds.length === 0) {
		return Result.ok(undefined)
	}
	const columns = {
		id: interfaces.id,
		jack_id: interfaces.jack_id,
		side: interfaces.side,
		positions: interfaces.positions,
		tenant_id: portDevice.tenant_id,
		site_id: outletSiteSql,
		location_id: interfaces.location_id,
	}
	const portRows =
		interfaceIds.length === 0
			? []
			: await getDb()
					.select({
						...columns,
						name: sql<string>`${portDevice.name} || ' / ' || ${interfaces.name}`,
					})
					.from(interfaces)
					.innerJoin(portDevice, eq(portDevice.id, interfaces.device_id))
					.leftJoin(outletLocation, eq(outletLocation.id, interfaces.location_id))
					.where(inArray(interfaces.id, interfaceIds))
	// A jack's first port stands for it (`firstJackPort`).
	const jackRows =
		jackIds.length === 0
			? []
			: await getDb()
					.select({ ...columns, name: outletNameSql })
					.from(panel_jacks)
					.innerJoin(interfaces, sql`${interfaces.id} = ${firstJackPort(panel_jacks.id)}`)
					.innerJoin(portDevice, eq(portDevice.id, interfaces.device_id))
					.leftJoin(outletLocation, eq(outletLocation.id, interfaces.location_id))
					.where(inArray(panel_jacks.id, jackIds))
	const siteId = await siteOfOwner(owner)
	const outlets = [
		...interfaceIds.map((portId) => ({
			row: portRows.find((port) => port.id === portId),
			missing: `Port #${portId} not found`,
			isJack: false,
		})),
		...jackIds.map((jackId) => ({
			row: jackRows.find((jack) => jack.jack_id === jackId),
			missing: `Jack #${jackId} not found`,
			isJack: true,
		})),
	]
	for (const { row, missing, isJack } of outlets) {
		if (!row || !visibleTo(row.tenant_id, scopeTenantIds)) {
			return Result.err(new ValidationError(missing))
		}
		if (row.side !== 'rear' || row.positions !== 1) {
			return Result.err(
				new ValidationError(
					`Port "${row.name}" is not an outlet (a single-position rear port)`,
				),
			)
		}
		if (!isJack && row.jack_id !== null) {
			return Result.err(
				new ValidationError(`Port "${row.name}" is in a jack; place the jack instead`),
			)
		}
		if (row.site_id === null || row.site_id !== siteId) {
			return Result.err(
				new ValidationError(`Outlet "${row.name}" is outside this floor plan's site`),
			)
		}
		if (scope !== null && row.location_id !== null && !scope.includes(row.location_id)) {
			return Result.err(new ValidationError(`Outlet "${row.name}" is in another location`))
		}
	}
	return Result.ok(undefined)
}

/**
 * Ids of the plan's areas and placements a scoped requester cannot see;
 * a save keeps them as they are. None for a global requester.
 */
async function hiddenPlanIds(
	id: number,
	scopeTenantIds: readonly number[] | undefined,
): Promise<{ areas: number[]; placements: number[] }> {
	if (scopeTenantIds === undefined) {
		return { areas: [], placements: [] }
	}
	const areas = await getDb()
		.select({ id: floorplan_areas.id })
		.from(floorplan_areas)
		.leftJoin(sites, eq(sites.id, floorplan_areas.site_id))
		.leftJoin(locations, eq(locations.id, floorplan_areas.location_id))
		.where(
			and(
				eq(floorplan_areas.attachment_id, id),
				outsideScope(
					sql`coalesce(${sites.tenant_id}, ${locations.tenant_id})`,
					scopeTenantIds,
				),
			),
		)
	const placements = await getDb()
		.select({ id: floorplan_placements.id })
		.from(floorplan_placements)
		.leftJoin(racks, eq(racks.id, floorplan_placements.rack_id))
		.leftJoin(devices, eq(devices.id, floorplan_placements.device_id))
		.leftJoin(interfaces, placedPortJoin)
		.leftJoin(portDevice, eq(portDevice.id, interfaces.device_id))
		.where(
			and(
				eq(floorplan_placements.attachment_id, id),
				outsideScope(placementTenantSql, scopeTenantIds),
			),
		)
	return { areas: areas.map((row) => row.id), placements: placements.map((row) => row.id) }
}

/** Areas and placements of a plan as stored, for the changelog entry of a save. */
async function planSnapshot(id: number): Promise<
	{
		areas: Pick<FloorplanAreaRow, 'site_id' | 'location_id' | 'label' | 'points'>[]
		placements: Pick<
			FloorplanPlacementRow,
			'rack_id' | 'device_id' | 'interface_id' | 'jack_id' | 'x' | 'y'
		>[]
	} & Pick<FloorplanJson, 'scale' | 'origin'>
> {
	const areas = await getDb()
		.select({
			site_id: floorplan_areas.site_id,
			location_id: floorplan_areas.location_id,
			label: floorplan_areas.label,
			points: floorplan_areas.points,
		})
		.from(floorplan_areas)
		.where(eq(floorplan_areas.attachment_id, id))
		.orderBy(asc(floorplan_areas.id))
	const placements = await getDb()
		.select({
			rack_id: floorplan_placements.rack_id,
			device_id: floorplan_placements.device_id,
			interface_id: floorplan_placements.interface_id,
			jack_id: floorplan_placements.jack_id,
			x: floorplan_placements.x,
			y: floorplan_placements.y,
		})
		.from(floorplan_placements)
		.where(eq(floorplan_placements.attachment_id, id))
		.orderBy(asc(floorplan_placements.id))
	return { areas, placements, ...(await planCalibration(id)) }
}

/**
 * Placing an outlet on a location's plan puts it (all ports of a jack) in
 * that location when it has none yet (one changelog entry per port). Runs
 * on the caller's `getDb()` (its transaction).
 */
async function locateOutlets(owner: AttachmentOwner, input: FloorplanPut): Promise<void> {
	const ids = input.placements.flatMap((p) =>
		p.interface_id === undefined ? [] : [p.interface_id],
	)
	const jackIds = input.placements.flatMap((p) => (p.jack_id === undefined ? [] : [p.jack_id]))
	if (owner.location_id === undefined || ids.length + jackIds.length === 0) {
		return
	}
	const unlocated = await getDb()
		.select()
		.from(interfaces)
		.where(
			and(
				or(
					ids.length === 0 ? undefined : inArray(interfaces.id, ids),
					jackIds.length === 0 ? undefined : inArray(interfaces.jack_id, jackIds),
				),
				isNull(interfaces.location_id),
			),
		)
	if (unlocated.length === 0) {
		return
	}
	await getDb()
		.update(interfaces)
		.set({ location_id: owner.location_id })
		.where(
			inArray(
				interfaces.id,
				unlocated.map((row) => row.id),
			),
		)
	for (const row of unlocated) {
		const before = toInterfaceJson(row)
		await logUpdate(
			'interface',
			before,
			Result.ok({ ...before, location_id: owner.location_id }),
		)
	}
}

/**
 * Replaces the areas and placements of the marked floor plan in one
 * transaction and records one changelog entry for the save. Items hidden
 * from a scoped requester stay unchanged. Returns the saved plan as
 * `getPlan` resolves it for the requester.
 */
export async function putPlan(
	id: number,
	input: FloorplanPut,
	scopeTenantIds?: readonly number[],
): Promise<Result<FloorplanJson, Error>> {
	const written = await tryWrite(
		() =>
			withTransaction(async (): Promise<Result<undefined, Error>> => {
				// Serializes with mark changes, which clear the plan.
				const [row] = await getDb()
					.select()
					.from(attachments)
					.where(eq(attachments.id, id))
					.for('update')
				if (!row) {
					return Result.err(new NotFoundError(NOT_FOUND))
				}
				if (row.is_floorplan === 0) {
					return Result.err(new ConflictError(NOT_MARKED))
				}
				const owner = ownerOf(row)
				const checked = await checkPlanInput(id, owner, input, scopeTenantIds)
				if (Result.isError(checked)) {
					return checked
				}
				const before = await planSnapshot(id)
				const hidden = await hiddenPlanIds(id, scopeTenantIds)
				await getDb()
					.delete(floorplan_areas)
					.where(
						and(
							eq(floorplan_areas.attachment_id, id),
							hidden.areas.length === 0
								? undefined
								: notInArray(floorplan_areas.id, hidden.areas),
						),
					)
				await getDb()
					.delete(floorplan_placements)
					.where(
						and(
							eq(floorplan_placements.attachment_id, id),
							hidden.placements.length === 0
								? undefined
								: notInArray(floorplan_placements.id, hidden.placements),
						),
					)
				if (input.areas.length > 0) {
					await getDb()
						.insert(floorplan_areas)
						.values(
							input.areas.map((area) => ({
								attachment_id: id,
								site_id: area.site_id ?? null,
								location_id: area.location_id ?? null,
								label: area.label || null,
								points: area.points,
							})),
						)
				}
				if (input.placements.length > 0) {
					await getDb()
						.insert(floorplan_placements)
						.values(
							input.placements.map((placement) => ({
								attachment_id: id,
								rack_id: placement.rack_id ?? null,
								device_id: placement.device_id ?? null,
								interface_id: placement.interface_id ?? null,
								jack_id: placement.jack_id ?? null,
								x: placement.x,
								y: placement.y,
							})),
						)
				}
				await getDb()
					.delete(floorplan_calibrations)
					.where(eq(floorplan_calibrations.attachment_id, id))
				if (input.scale !== null || input.origin !== null) {
					await getDb().insert(floorplan_calibrations).values({
						attachment_id: id,
						scale: input.scale,
						origin: input.origin,
					})
				}
				await locateOutlets(owner, input)
				const after = await planSnapshot(id)
				await logUpdate(
					'attachment',
					{ ...toJson(row), plan: before },
					Result.ok({ ...toJson(row), plan: after }),
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
	return getPlan(id, scopeTenantIds)
}

/**
 * Removes placements whose rack or device no longer lies in its plan
 * owner's scope (see `ownerLocations`), and outlets that left the owner's
 * site (by their own location, else their panel's) or, on a location's
 * plan, whose location was cleared or left the owner's scope (placing sets
 * it, see `locateOutlets`), after a site, location, rack or outlet
 * location change. Runs on the caller's `getDb()` (its transaction).
 */
export async function prunePlacements(): Promise<void> {
	await getDb().execute(sql`
		delete from ${floorplan_placements} fp
		using ${attachments} a
		where a.id = fp.attachment_id
		and (fp.interface_id is not null or fp.jack_id is not null)
		and not exists (
			select 1
			from ${interfaces} i
			join ${devices} d on d.id = i.device_id
			left join ${locations} il on il.id = i.location_id
			where i.id = coalesce(
				fp.interface_id,
				(select min(jp.id) from ${interfaces} jp where jp.jack_id = fp.jack_id)
			)
			and coalesce(il.site_id, d.site_id) = coalesce(
				a.site_id,
				(select l.site_id from ${locations} l where l.id = a.location_id)
			)
			and (
				a.location_id is null
				or a.location_id in (
					with recursive ancestors(id) as (
						select i.location_id
						union
						select l.parent_id from ${locations} l
						join ancestors on l.id = ancestors.id
						where l.parent_id is not null
					)
					select id from ancestors
				)
			)
		)
	`)
	await getDb().execute(sql`
		delete from ${floorplan_placements} fp
		using ${attachments} a
		where a.id = fp.attachment_id
		and fp.interface_id is null
		and fp.jack_id is null
		and not exists (
			select 1
			from (
				select site_id, location_id from ${racks} where id = fp.rack_id
				union all
				select site_id, location_id from ${devices} where id = fp.device_id
			) o
			where o.site_id = a.site_id
			or a.location_id in (
				with recursive ancestors(id) as (
					select o.location_id
					union
					select l.parent_id from ${locations} l
					join ancestors on l.id = ancestors.id
					where l.parent_id is not null
				)
				select id from ancestors
			)
		)
	`)
}

/**
 * Floor-plan data deleting an owner removes: its marked plan's areas and
 * placements, and the areas on other plans linking to it.
 */
async function floorplanImpact(owner: AttachmentOwner): Promise<FloorplanImpactJson> {
	const [plan] = await getDb()
		.select({ id: attachments.id })
		.from(attachments)
		.where(and(ownerCondition(owner), eq(attachments.is_floorplan, 1)))
	const linked =
		owner.site_id !== undefined
			? eq(floorplan_areas.site_id, owner.site_id)
			: eq(floorplan_areas.location_id, owner.location_id ?? 0)
	return {
		areas: plan
			? await getDb().$count(floorplan_areas, eq(floorplan_areas.attachment_id, plan.id))
			: 0,
		placements: plan
			? await getDb().$count(
					floorplan_placements,
					eq(floorplan_placements.attachment_id, plan.id),
				)
			: 0,
		linkedFrom: await getDb().$count(floorplan_areas, linked),
	}
}

/**
 * Refuses deleting an owner that has floor-plan data unless `confirmed`
 * (`?confirm=floorplan`); the error carries the impact for the client.
 */
export async function checkFloorplanDelete(
	owner: AttachmentOwner,
	confirmed: boolean,
): Promise<Result<undefined, Error>> {
	if (confirmed) {
		return Result.ok(undefined)
	}
	const impact = await floorplanImpact(owner)
	return impact.areas + impact.placements + impact.linkedFrom > 0
		? Result.err(new FloorplanImpactError(impact))
		: Result.ok(undefined)
}

/**
 * Plans referencing an object (`FloorplanLinkJson`): the one placing a rack
 * or device, or those with an area linking to a site or location. Plans
 * whose owner lies outside `scopeTenantIds` are left out.
 */
export async function listFloorplanLinks(
	query: FloorplanLinksQuery,
	scopeTenantIds?: readonly number[],
): Promise<FloorplanLinkJson[]> {
	const ownerTenant = sql<number | null>`coalesce(${sites.tenant_id}, ${locations.tenant_id})`
	const columns = {
		attachment_id: attachments.id,
		site_id: attachments.site_id,
		location_id: attachments.location_id,
		owner_name: sql<string>`coalesce(${sites.name}, ${locations.name})`,
	}
	const visible = scopeCondition(ownerTenant, scopeTenantIds)
	if (query.interface !== undefined) {
		return getDb()
			.select(columns)
			.from(floorplan_placements)
			.innerJoin(attachments, eq(attachments.id, floorplan_placements.attachment_id))
			.leftJoin(sites, eq(sites.id, attachments.site_id))
			.leftJoin(locations, eq(locations.id, attachments.location_id))
			.where(
				and(
					or(
						eq(floorplan_placements.interface_id, query.interface),
						eq(
							floorplan_placements.jack_id,
							sql`(select jack_id from ${interfaces} where id = ${query.interface})`,
						),
					),
					visible,
				),
			)
	}
	if (query.rack !== undefined || query.device !== undefined) {
		return getDb()
			.select(columns)
			.from(floorplan_placements)
			.innerJoin(attachments, eq(attachments.id, floorplan_placements.attachment_id))
			.leftJoin(sites, eq(sites.id, attachments.site_id))
			.leftJoin(locations, eq(locations.id, attachments.location_id))
			.where(
				and(
					query.rack !== undefined
						? eq(floorplan_placements.rack_id, query.rack)
						: eq(floorplan_placements.device_id, query.device ?? 0),
					visible,
				),
			)
	}
	return getDb()
		.select(columns)
		.from(floorplan_areas)
		.innerJoin(attachments, eq(attachments.id, floorplan_areas.attachment_id))
		.leftJoin(sites, eq(sites.id, attachments.site_id))
		.leftJoin(locations, eq(locations.id, attachments.location_id))
		.where(
			and(
				query.site !== undefined
					? eq(floorplan_areas.site_id, query.site)
					: eq(floorplan_areas.location_id, query.location ?? 0),
				visible,
			),
		)
		.orderBy(asc(columns.owner_name), asc(attachments.id))
}

/**
 * Placed outlets of a device (`FloorplanOutletJson`): a panel's own placed
 * rear ports, or for any other device the placed rear ports its ports are
 * cabled to directly. Plans whose owner lies outside `scopeTenantIds`, and
 * outlets on panels outside it, are left out.
 */
export async function listOutlets(
	deviceId: number,
	scopeTenantIds?: readonly number[],
): Promise<FloorplanOutletJson[]> {
	const ownerTenant = sql<number | null>`coalesce(${sites.tenant_id}, ${locations.tenant_id})`
	const local = alias(interfaces, 'local_iface')
	// The device's own port, or the port at the other end of the outlet's cable.
	const localId = sql<number>`coalesce(
		case when ${portDevice.id} = ${deviceId} then ${interfaces.id} end,
		(select case when c.a_interface_id = ${interfaces.id} then c.b_interface_id else c.a_interface_id end
			from ${cables} c
			where c.a_interface_id = ${interfaces.id} or c.b_interface_id = ${interfaces.id})
	)`
	const rows = await getDb()
		.select({
			local_interface_id: localId,
			interface_id: interfaces.id,
			jack_id: floorplan_placements.jack_id,
			attachment_id: attachments.id,
			site_id: attachments.site_id,
			location_id: attachments.location_id,
			owner_name: sql<string>`coalesce(${sites.name}, ${locations.name})`,
			...portColumns,
		})
		.from(floorplan_placements)
		// Every port of a placed jack is an outlet of its own here.
		.innerJoin(
			interfaces,
			or(
				eq(interfaces.id, floorplan_placements.interface_id),
				eq(interfaces.jack_id, floorplan_placements.jack_id),
			),
		)
		.leftJoin(panel_jacks, eq(panel_jacks.id, floorplan_placements.jack_id))
		.innerJoin(portDevice, eq(portDevice.id, interfaces.device_id))
		.innerJoin(attachments, eq(attachments.id, floorplan_placements.attachment_id))
		.leftJoin(sites, eq(sites.id, attachments.site_id))
		.leftJoin(locations, eq(locations.id, attachments.location_id))
		.innerJoin(local, eq(local.id, localId))
		.where(
			and(
				eq(local.device_id, deviceId),
				scopeCondition(ownerTenant, scopeTenantIds),
				scopeCondition(portDevice.tenant_id, scopeTenantIds),
			),
		)
		.orderBy(asc(interfaces.id))
	const portsOf = await outletPorts(
		rows.map((row) => ({
			interface_id: row.interface_id,
			jack_id: row.jack_id,
		})),
	)
	// Inner joins: every row is an outlet, so its port columns are set.
	return rows.map(({ port_device_id, port_device_name, port_name, jack_id, ...row }) => {
		const ports = portsOf({ interface_id: row.interface_id, jack_id })
		return {
			...row,
			port: {
				device_id: port_device_id,
				device_name: port_device_name,
				name: port_name,
				connected: ports.some((port) => port.connected),
				ports,
			},
		}
	})
}

/**
 * One page of the marked floor plans whose owner matches the tenant filters,
 * ordered by site and owner name. `search` matches the owner or site name. The
 * area and marker counts leave out content outside `params.scopeTenantIds`, like
 * `getPlan`.
 */
export async function listFloorplans(
	params: TenantFilterParams & ListParams,
): Promise<Page<FloorplanListJson>> {
	const ownerSite = alias(sites, 'owner_site')
	const ownerTenant = sql<number | null>`coalesce(${sites.tenant_id}, ${locations.tenant_id})`
	const ownerName = sql<string>`coalesce(${sites.name}, ${locations.name})`
	const where = and(
		eq(attachments.is_floorplan, 1),
		searchCondition(params.search, [ownerName, ownerSite.name]),
		...tenantConditions(ownerTenant, params),
	)
	const rows = await getDb()
		.select({
			attachment_id: attachments.id,
			site_id: attachments.site_id,
			location_id: attachments.location_id,
			owner_name: ownerName,
			location_type: locations.type,
			site_name: ownerSite.name,
			tenant_id: ownerTenant,
			tenant_name: tenants.name,
		})
		.from(attachments)
		.leftJoin(sites, eq(sites.id, attachments.site_id))
		.leftJoin(locations, eq(locations.id, attachments.location_id))
		.innerJoin(
			ownerSite,
			eq(ownerSite.id, sql`coalesce(${attachments.site_id}, ${locations.site_id})`),
		)
		.leftJoin(tenants, eq(tenants.id, ownerTenant))
		.where(where)
		.orderBy(asc(ownerSite.name), asc(ownerName), asc(attachments.id))
		.limit(params.limit)
		.offset(offsetOf(params))
	const [{ total }] = await getDb()
		.select({ total: count() })
		.from(attachments)
		.leftJoin(sites, eq(sites.id, attachments.site_id))
		.leftJoin(locations, eq(locations.id, attachments.location_id))
		.innerJoin(
			ownerSite,
			eq(ownerSite.id, sql`coalesce(${attachments.site_id}, ${locations.site_id})`),
		)
		.where(where)
	if (rows.length === 0) {
		return pageOf([], total, params)
	}
	const ids = rows.map((row) => row.attachment_id)
	const scope = params.scopeTenantIds
	const areaCounts = await getDb()
		.select({ id: floorplan_areas.attachment_id, n: count() })
		.from(floorplan_areas)
		.leftJoin(sites, eq(sites.id, floorplan_areas.site_id))
		.leftJoin(locations, eq(locations.id, floorplan_areas.location_id))
		.where(
			and(
				inArray(floorplan_areas.attachment_id, ids),
				scopeCondition(sql`coalesce(${sites.tenant_id}, ${locations.tenant_id})`, scope),
			),
		)
		.groupBy(floorplan_areas.attachment_id)
	const placementCounts = await getDb()
		.select({ id: floorplan_placements.attachment_id, n: count() })
		.from(floorplan_placements)
		.leftJoin(racks, eq(racks.id, floorplan_placements.rack_id))
		.leftJoin(devices, eq(devices.id, floorplan_placements.device_id))
		.leftJoin(interfaces, placedPortJoin)
		.leftJoin(portDevice, eq(portDevice.id, interfaces.device_id))
		.where(
			and(
				inArray(floorplan_placements.attachment_id, ids),
				scopeCondition(placementTenantSql, scope),
			),
		)
		.groupBy(floorplan_placements.attachment_id)
	const areas = new Map(areaCounts.map((row) => [row.id, row.n]))
	const placements = new Map(placementCounts.map((row) => [row.id, row.n]))
	return pageOf(
		rows.map((row) => ({
			...row,
			areas: areas.get(row.attachment_id) ?? 0,
			placements: placements.get(row.attachment_id) ?? 0,
		})),
		total,
		params,
	)
}

/**
 * Deletes an attachment. The marked floor plan with areas or placements
 * needs `confirmed` (`?confirm=floorplan`).
 */
export async function deleteAttachment(
	id: number,
	confirmed = false,
): Promise<Result<AttachmentJson, Error>> {
	const current = await getAttachmentRow(id)
	if (Result.isError(current)) {
		return current
	}
	if (current.value.is_floorplan === 1 && !confirmed) {
		const impact = {
			areas: await getDb().$count(floorplan_areas, eq(floorplan_areas.attachment_id, id)),
			placements: await getDb().$count(
				floorplan_placements,
				eq(floorplan_placements.attachment_id, id),
			),
			linkedFrom: 0,
		}
		if (impact.areas + impact.placements > 0) {
			return Result.err(new FloorplanImpactError(impact))
		}
	}
	const deleted = await tryWrite(() => getDb().delete(attachments).where(eq(attachments.id, id)))
	if (Result.isError(deleted)) {
		return deleted
	}
	await removeAttachmentFiles([current.value])
	return await logDelete('attachment', toJson(current.value))
}

/**
 * Deletes every attachment of an owner that is being deleted. Runs on the
 * caller's `getDb()` (its transaction) and returns the removed rows: the
 * caller removes their files with `removeAttachmentFiles` after the commit.
 */
export async function deleteOwnerAttachments(owner: AttachmentOwner): Promise<AttachmentRow[]> {
	const rows = await getDb().delete(attachments).where(ownerCondition(owner)).returning()
	for (const row of rows) {
		await logDelete('attachment', toJson(row))
	}
	return rows
}

/**
 * Startup sweep: removes stored files (and leftover `.tmp` files) without a
 * row, and logs rows whose file is missing. Must run before the server
 * accepts uploads. Unrelated files in the directory are left alone.
 */
export async function sweepAttachmentFiles(): Promise<
	Result<{ removed: number; missing: number }, Error>
> {
	const files = await listAttachmentFiles()
	if (Result.isError(files)) {
		return files
	}
	const rows = await getDb()
		.select({
			id: attachments.id,
			storage_key: attachments.storage_key,
			mime: attachments.mime,
		})
		.from(attachments)
	const expected = new Set(rows.map((row) => attachmentFileName(row.storage_key, row.mime)))
	let removed = 0
	for (const name of files.value) {
		if (STORED_FILE.test(name) && !expected.has(name)) {
			const gone = await removeStoredFile(name)
			if (Result.isError(gone)) {
				return gone
			}
			removed++
		}
	}
	const present = new Set(files.value)
	const missing = rows.filter(
		(row) => !present.has(attachmentFileName(row.storage_key, row.mime)),
	)
	for (const row of missing) {
		console.warn(`Attachment #${row.id}: file ${row.storage_key} is missing`)
	}
	return Result.ok({ removed, missing: missing.length })
}
