/**
 * Attachments: PNG / JPEG images owned by one site or location. The row
 * holds the metadata, the file lives on disk (`storage.ts`). A new file is
 * written (tmp, then renamed) before its row; a failed insert removes it
 * again. A delete removes the row first and the file after the commit, so a
 * crash leaves at worst an orphan file, which the startup sweep removes.
 */
import { Result } from 'better-result'
import { and, asc, eq, inArray, isNull, ne, notInArray, or, type SQL, sql } from 'drizzle-orm'
import type { PgColumn } from 'drizzle-orm/pg-core'
import type {
	AttachmentJson,
	AttachmentMime,
	AttachmentUpdate,
	FloorplanCandidateJson,
	FloorplanImpactJson,
	FloorplanJson,
	FloorplanLinkJson,
	FloorplanLinksQuery,
	FloorplanPut,
} from 'shared/src/schemas'
import {
	attachments,
	device_roles,
	devices,
	floorplan_areas,
	floorplan_placements,
	locations,
	racks,
	sites,
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
import { ConflictError, FloorplanImpactError, NotFoundError, ValidationError } from './errors'
import { checkExists, findById, insertedId, isPatchEmpty, pickDefined, tryWrite } from './list'

export type AttachmentRow = typeof attachments.$inferSelect
type FloorplanAreaRow = typeof floorplan_areas.$inferSelect
type FloorplanPlacementRow = typeof floorplan_placements.$inferSelect

/** Owner of an attachment: exactly one of the two ids is set. */
export interface AttachmentOwner {
	site_id?: number
	location_id?: number
}

/** Uploaded file: the client's file name and the raw bytes. */
export interface AttachmentUpload {
	name: string
	bytes: Uint8Array
}

const NOT_FOUND = 'Attachment not found'
const FLOORPLAN_TAKEN = 'Another attachment is already marked as the floor plan'
const NOT_MARKED = 'Only the marked floor plan can hold areas and markers'
const ALREADY_PLACED = 'A rack or device is already placed on another floor plan'

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
	return sql`false`
}

/** 404 when the owning site or location does not exist. */
async function checkOwner(owner: AttachmentOwner): Promise<Result<undefined, Error>> {
	if (owner.site_id !== undefined) {
		return checkExists(sites, owner.site_id, 'Site not found')
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
}

/**
 * Updates the description and the floor-plan mark. Areas and placements
 * exist only on the marked attachment, so in one transaction marking
 * unmarks the owner's previous floor plan and clears its plan, and
 * unmarking clears this attachment's plan. The client confirms that loss
 * beforehand.
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
	const owner: AttachmentOwner = {
		site_id: current.value.site_id ?? undefined,
		location_id: current.value.location_id ?? undefined,
	}
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
 * resolved. `scopeTenantId` (a scoped requester) leaves out areas whose
 * target and placements whose rack or device belong to another tenant.
 * An unmarked attachment has an empty plan.
 */
export async function getPlan(
	id: number,
	scopeTenantId?: number,
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
			has_hidden_content: false,
		})
	}
	const areaTenant = sql<number | null>`coalesce(${sites.tenant_id}, ${locations.tenant_id})`
	const areas = await getDb()
		.select({
			id: floorplan_areas.id,
			site_id: floorplan_areas.site_id,
			location_id: floorplan_areas.location_id,
			label: floorplan_areas.label,
			points: floorplan_areas.points,
			target_name: sql<string>`coalesce(${sites.name}, ${locations.name})`,
			target_type: locations.type,
		})
		.from(floorplan_areas)
		.leftJoin(sites, eq(sites.id, floorplan_areas.site_id))
		.leftJoin(locations, eq(locations.id, floorplan_areas.location_id))
		.where(
			and(
				eq(floorplan_areas.attachment_id, id),
				scopeTenantId === undefined ? undefined : eq(areaTenant, scopeTenantId),
			),
		)
		.orderBy(asc(floorplan_areas.id))
	const placementTenant = sql<number | null>`coalesce(${racks.tenant_id}, ${devices.tenant_id})`
	const placements = await getDb()
		.select({
			id: floorplan_placements.id,
			rack_id: floorplan_placements.rack_id,
			device_id: floorplan_placements.device_id,
			x: floorplan_placements.x,
			y: floorplan_placements.y,
			name: sql<string>`coalesce(${racks.name}, ${devices.name})`,
			status: devices.status,
			role_icon: device_roles.icon,
		})
		.from(floorplan_placements)
		.leftJoin(racks, eq(racks.id, floorplan_placements.rack_id))
		.leftJoin(devices, eq(devices.id, floorplan_placements.device_id))
		.leftJoin(device_roles, eq(device_roles.id, devices.device_role_id))
		.where(
			and(
				eq(floorplan_placements.attachment_id, id),
				scopeTenantId === undefined ? undefined : eq(placementTenant, scopeTenantId),
			),
		)
		.orderBy(asc(floorplan_placements.id))
	// A scoped editor must still be warned before a mark change clears
	// hidden content. Reveal only its existence, never its targets or counts.
	const hasHiddenContent =
		scopeTenantId !== undefined &&
		((await getDb().$count(floorplan_areas, eq(floorplan_areas.attachment_id, id))) >
			areas.length ||
			(await getDb().$count(
				floorplan_placements,
				eq(floorplan_placements.attachment_id, id),
			)) > placements.length)
	return Result.ok({ attachment_id: id, areas, placements, has_hidden_content: hasHiddenContent })
}

function ownerOf(row: AttachmentRow): AttachmentOwner {
	return { site_id: row.site_id ?? undefined, location_id: row.location_id ?? undefined }
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

function visibleTo(tenant: number | null, scopeTenantId: number | undefined): boolean {
	return scopeTenantId === undefined || tenant === scopeTenantId
}

/** Racks and devices the editor may place on a plan (`FloorplanCandidateJson`). */
export async function listPlanCandidates(
	id: number,
	scopeTenantId?: number,
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
				scopeTenantId === undefined ? undefined : eq(racks.tenant_id, scopeTenantId),
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
				free,
				scopeTenantId === undefined ? undefined : eq(devices.tenant_id, scopeTenantId),
			),
		)
		.orderBy(asc(devices.name), asc(devices.id))
	return Result.ok([
		...rackRows.map((row) => ({ ...row, device_id: null, status: null, role_icon: null })),
		...deviceRows.map((row) => ({ ...row, rack_id: null })),
	])
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
	scopeTenantId: number | undefined,
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
			if (!row || !visibleTo(row.tenant_id, scopeTenantId)) {
				return Result.err(new ValidationError(`${noun} #${targetId} not found`))
			}
		}
	}

	const rackIds = input.placements.flatMap((p) => (p.rack_id === undefined ? [] : [p.rack_id]))
	const deviceIds = input.placements.flatMap((p) =>
		p.device_id === undefined ? [] : [p.device_id],
	)
	if (new Set(rackIds).size < rackIds.length || new Set(deviceIds).size < deviceIds.length) {
		return Result.err(new ValidationError('Each rack or device can be placed only once'))
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
	const scope = await ownerLocations(owner)
	for (const [ids, rows, noun] of [
		[rackIds, placedRacks, 'Rack'],
		[deviceIds, placedDevices, 'Device'],
	] as const) {
		for (const objectId of ids) {
			const row = rows.find((object) => object.id === objectId)
			if (!row || !visibleTo(row.tenant_id, scopeTenantId)) {
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
				),
			),
		)
		.limit(1)
	return elsewhere.length > 0
		? Result.err(new ConflictError(ALREADY_PLACED))
		: Result.ok(undefined)
}

/**
 * Ids of the plan's areas and placements a scoped requester cannot see;
 * a save keeps them as they are. None for a global requester.
 */
async function hiddenPlanIds(
	id: number,
	scopeTenantId: number | undefined,
): Promise<{ areas: number[]; placements: number[] }> {
	if (scopeTenantId === undefined) {
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
				sql`coalesce(${sites.tenant_id}, ${locations.tenant_id}) is distinct from ${scopeTenantId}`,
			),
		)
	const placements = await getDb()
		.select({ id: floorplan_placements.id })
		.from(floorplan_placements)
		.leftJoin(racks, eq(racks.id, floorplan_placements.rack_id))
		.leftJoin(devices, eq(devices.id, floorplan_placements.device_id))
		.where(
			and(
				eq(floorplan_placements.attachment_id, id),
				sql`coalesce(${racks.tenant_id}, ${devices.tenant_id}) is distinct from ${scopeTenantId}`,
			),
		)
	return { areas: areas.map((row) => row.id), placements: placements.map((row) => row.id) }
}

/** Areas and placements of a plan as stored, for the changelog entry of a save. */
async function planSnapshot(id: number): Promise<{
	areas: Pick<FloorplanAreaRow, 'site_id' | 'location_id' | 'label' | 'points'>[]
	placements: Pick<FloorplanPlacementRow, 'rack_id' | 'device_id' | 'x' | 'y'>[]
}> {
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
			x: floorplan_placements.x,
			y: floorplan_placements.y,
		})
		.from(floorplan_placements)
		.where(eq(floorplan_placements.attachment_id, id))
		.orderBy(asc(floorplan_placements.id))
	return { areas, placements }
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
	scopeTenantId?: number,
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
				const checked = await checkPlanInput(id, ownerOf(row), input, scopeTenantId)
				if (Result.isError(checked)) {
					return checked
				}
				const before = await planSnapshot(id)
				const hidden = await hiddenPlanIds(id, scopeTenantId)
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
								x: placement.x,
								y: placement.y,
							})),
						)
				}
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
	return getPlan(id, scopeTenantId)
}

/**
 * Removes placements whose rack or device no longer lies in its plan
 * owner's scope (see `ownerLocations`), after a site, location or rack
 * change. Runs on the caller's `getDb()` (its transaction).
 */
export async function prunePlacements(): Promise<void> {
	await getDb().execute(sql`
		delete from ${floorplan_placements} fp
		using ${attachments} a
		where a.id = fp.attachment_id
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
 * whose owner lies outside `scopeTenantId` are left out.
 */
export async function listFloorplanLinks(
	query: FloorplanLinksQuery,
	scopeTenantId?: number,
): Promise<FloorplanLinkJson[]> {
	const ownerTenant = sql<number | null>`coalesce(${sites.tenant_id}, ${locations.tenant_id})`
	const columns = {
		attachment_id: attachments.id,
		site_id: attachments.site_id,
		location_id: attachments.location_id,
		owner_name: sql<string>`coalesce(${sites.name}, ${locations.name})`,
	}
	const visible = scopeTenantId === undefined ? undefined : eq(ownerTenant, scopeTenantId)
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
