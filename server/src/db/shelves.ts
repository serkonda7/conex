import { Result } from 'better-result'
import { and, asc, eq, sql } from 'drizzle-orm'
import type { ShelfCreate, ShelfUpdate } from 'shared/src/schemas'
import { devices, racks, shelves } from '../schema'
import { checkBounds, checkOverlap, type Face, faceOf } from '../services/occupancy'
import { logCreate, logDelete, logUpdate } from './changelog'
import { getDb } from './connection'
import { ConflictError, NotFoundError } from './errors'
import type { ListParams, Page } from './list'
import {
	exists,
	findById,
	findOne,
	insertedId,
	isPatchEmpty,
	orderOf,
	pageRows,
	pickDefined,
	searchCondition,
	tryWrite,
} from './list'
import { rackHeightOf, rackSpansOf, shelfBlockedRange } from './racks'

export type ShelfRow = typeof shelves.$inferSelect

const SHELF_NAME_IN_USE = 'Shelf name is already in use'

export interface ShelfListParams extends ListParams {
	rack?: number
	sort: 'name'
	order: 'asc' | 'desc'
	/** Tenant scope (own tenant only, strict) resolved via the rack; `undefined` = unconstrained. */
	scopeTenantId?: number
}

export function listShelves(params: ShelfListParams): Promise<Page<ShelfRow>> {
	const where = and(
		searchCondition(params.search, [shelves.name, shelves.description]),
		params.rack ? eq(shelves.rack_id, params.rack) : undefined,
		params.scopeTenantId !== undefined
			? sql`EXISTS (SELECT 1 FROM ${racks} AS scope_r WHERE scope_r.id = ${shelves.rack_id} AND scope_r.tenant_id = ${params.scopeTenantId})`
			: undefined,
	)
	return pageRows(shelves, where, [orderOf(shelves.name, params.order), asc(shelves.id)], params)
}

export function getShelf(id: number): Promise<Result<ShelfRow, Error>> {
	return findById(shelves, id, 'Shelf not found')
}

/** Effective mount of a shelf, as created or after a patch. */
interface ShelfMount {
	name: string
	rack_id: number
	face: Face
	is_full_depth: boolean
	position_u: number
	mount_height: number
	mount_usable: boolean
	reserved_height: number
}

/**
 * Validates a shelf mount: the mount hardware and the blocked span must fit
 * the rack, and the blocked span must not overlap other occupants (devices
 * plus shelf blockers). `excludeShelfId` skips the shelf being updated.
 */
async function checkShelfMount(
	mount: ShelfMount,
	excludeShelfId?: number,
): Promise<Result<undefined, Error>> {
	const rack = await findOne(racks, eq(racks.id, mount.rack_id))
	if (!rack) {
		return Result.err(new NotFoundError('Rack not found'))
	}
	const height = await rackHeightOf(rack)
	const label = `Shelf "${mount.name}"`
	// The mount hardware itself must fit even when it stays usable.
	const mountBounds = checkBounds(
		{ position_u: mount.position_u, height_u: mount.mount_height },
		height,
		label,
	)
	if (Result.isError(mountBounds)) {
		return mountBounds
	}
	const blocked = shelfBlockedRange(mount)
	if (!blocked) {
		return Result.ok(undefined)
	}
	const bounds = checkBounds(blocked, height, label)
	if (Result.isError(bounds)) {
		return bounds
	}
	const spanId = excludeShelfId === undefined ? undefined : -excludeShelfId
	return checkOverlap(
		{
			id: spanId ?? 0,
			name: mount.name,
			position_u: blocked.position_u,
			height_u: blocked.height_u,
			face: mount.face,
			is_full_depth: mount.is_full_depth,
		},
		await rackSpansOf(mount.rack_id),
		label,
		spanId,
	)
}

export async function createShelf(input: ShelfCreate): Promise<Result<ShelfRow, Error>> {
	const mount: ShelfMount = {
		name: input.name ?? 'shelf',
		rack_id: input.rack_id,
		face: input.face ?? null,
		is_full_depth: input.is_full_depth ?? true,
		position_u: input.position_u,
		mount_height: input.mount_height ?? 1,
		mount_usable: input.mount_usable ?? false,
		reserved_height: input.reserved_height ?? 0,
	}
	const valid = await checkShelfMount(mount)
	if (Result.isError(valid)) {
		return valid
	}
	const row: Omit<ShelfRow, 'id'> = {
		rack_id: mount.rack_id,
		name: input.name ?? null,
		face: mount.face,
		position_u: mount.position_u,
		mount_height: mount.mount_height,
		mount_usable: mount.mount_usable ? 1 : 0,
		reserved_height: mount.reserved_height,
		is_full_depth: mount.is_full_depth ? 1 : 0,
		description: input.description ?? null,
	}
	const id = await tryWrite(
		async () =>
			insertedId(await getDb().insert(shelves).values(row).returning({ id: shelves.id })),
		() => new ConflictError(SHELF_NAME_IN_USE),
	)
	if (Result.isError(id)) {
		return id
	}
	return await logCreate('shelf', await getShelf(id.value))
}

export async function updateShelf(
	id: number,
	input: ShelfUpdate,
): Promise<Result<ShelfRow, Error>> {
	const current = await getShelf(id)
	if (Result.isError(current)) {
		return current
	}
	const node = current.value
	// Devices on the shelf share its rack; moving it would strand them.
	if (
		input.rack_id !== undefined &&
		input.rack_id !== node.rack_id &&
		(await exists(devices, eq(devices.shelf_id, id)))
	) {
		return Result.err(
			new ConflictError('Shelf still has devices; remove them before moving racks'),
		)
	}
	const mountChanged =
		input.rack_id !== undefined ||
		input.position_u !== undefined ||
		input.mount_height !== undefined ||
		input.mount_usable !== undefined ||
		input.reserved_height !== undefined ||
		input.face !== undefined ||
		input.is_full_depth !== undefined
	if (mountChanged || input.name !== undefined) {
		const valid = await checkShelfMount(
			{
				name: input.name ?? node.name ?? 'shelf',
				rack_id: input.rack_id ?? node.rack_id,
				face: input.face !== undefined ? input.face : faceOf(node.face),
				is_full_depth: input.is_full_depth ?? node.is_full_depth !== 0,
				position_u: input.position_u ?? node.position_u,
				mount_height: input.mount_height ?? node.mount_height,
				mount_usable: input.mount_usable ?? node.mount_usable !== 0,
				reserved_height: input.reserved_height ?? node.reserved_height,
			},
			id,
		)
		if (Result.isError(valid)) {
			return valid
		}
	}
	const patch: Partial<ShelfRow> = pickDefined(input, [
		'name',
		'rack_id',
		'face',
		'position_u',
		'mount_height',
		'reserved_height',
		'description',
	])
	if (input.mount_usable !== undefined) {
		patch.mount_usable = input.mount_usable ? 1 : 0
	}
	if (input.is_full_depth !== undefined) {
		patch.is_full_depth = input.is_full_depth ? 1 : 0
	}
	if (!isPatchEmpty(patch)) {
		const written = await tryWrite(
			() => getDb().update(shelves).set(patch).where(eq(shelves.id, id)),
			() => new ConflictError(SHELF_NAME_IN_USE),
		)
		if (Result.isError(written)) {
			return written
		}
	}
	return await logUpdate('shelf', node, await getShelf(id))
}

export async function deleteShelf(id: number): Promise<Result<ShelfRow, Error>> {
	const current = await getShelf(id)
	if (Result.isError(current)) {
		return current
	}
	// Devices on the shelf stay assigned to the rack, just unplaced.
	const deleted = await tryWrite(() =>
		getDb().transaction(async (tx) => {
			await tx.update(devices).set({ shelf_id: null }).where(eq(devices.shelf_id, id))
			await tx.delete(shelves).where(eq(shelves.id, id))
		}),
	)
	if (Result.isError(deleted)) {
		return deleted
	}
	return await logDelete('shelf', current.value)
}
