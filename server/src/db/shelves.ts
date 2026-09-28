import { Result } from 'better-result'
import { and, asc, count, desc, eq, type SQL, sql } from 'drizzle-orm'
import type { ShelfCreate, ShelfUpdate } from 'shared/src/schemas'
import { devices, racks, shelves } from '../schema'
import { checkBounds, checkOverlap } from '../services/occupancy'
import { getDb } from './connection'
import { ConflictError, isUniqueViolation, NotFoundError } from './errors'
import type { ListParams, Page } from './list'
import { errOf, isPatchEmpty, offsetOf, pageOf, searchPattern } from './list'
import { rackHeightOf, rackSpansOf, shelfBlockedRange } from './racks'

export type ShelfRow = typeof shelves.$inferSelect

export interface ShelfListParams extends ListParams {
	rack?: number
	sort: 'name'
	order: 'asc' | 'desc'
	/** Tenant scope (own tenant only, strict) resolved via the rack; `undefined` = unconstrained. */
	scopeTenantId?: number
}

export async function listShelves(params: ShelfListParams): Promise<Page<ShelfRow>> {
	const db = getDb()
	const pattern = searchPattern(params.search)
	const conditions: SQL[] = []
	if (params.search) {
		conditions.push(
			sql`(${shelves.name} ILIKE ${pattern} ESCAPE '\\' OR ${shelves.description} ILIKE ${pattern} ESCAPE '\\')`,
		)
	}
	if (params.rack) {
		conditions.push(eq(shelves.rack_id, params.rack))
	}
	if (params.scopeTenantId !== undefined) {
		conditions.push(
			sql`EXISTS (SELECT 1 FROM racks AS scope_r WHERE scope_r.id = ${shelves.rack_id} AND scope_r.tenant_id = ${params.scopeTenantId})`,
		)
	}
	const where = conditions.length > 0 ? and(...conditions) : undefined
	const items = await db
		.select()
		.from(shelves)
		.where(where)
		.orderBy(params.order === 'desc' ? desc(shelves.name) : asc(shelves.name), asc(shelves.id))
		.limit(params.limit)
		.offset(offsetOf(params))
	const totalRow = (await db.select({ n: count() }).from(shelves).where(where).limit(1))[0]
	return pageOf(items, totalRow?.n ?? 0, params)
}

export async function getShelf(id: number): Promise<Result<ShelfRow, Error>> {
	const row = (await getDb().select().from(shelves).where(eq(shelves.id, id)).limit(1))[0]
	if (!row) {
		return Result.err(new NotFoundError('Shelf not found'))
	}
	return Result.ok(row)
}

async function checkShelfBounds(
	name: string,
	rackId: number,
	positionU: number,
	mountHeight: number,
	mountUsable: boolean,
	reservedHeight: number,
): Promise<Result<undefined, Error>> {
	const rack = (await getDb().select().from(racks).where(eq(racks.id, rackId)).limit(1))[0]
	if (!rack) {
		return Result.err(new NotFoundError('Rack not found'))
	}
	const height = await rackHeightOf(rack)
	const blocked = shelfBlockedRange({
		position_u: positionU,
		mount_height: mountHeight,
		mount_usable: mountUsable,
		reserved_height: reservedHeight,
	})
	// The mount hardware itself must fit even when it stays usable.
	const mountBounds = checkBounds(
		{ position_u: positionU, height_u: mountHeight },
		height,
		`Shelf "${name}"`,
	)
	if (Result.isError(mountBounds)) {
		return Result.err(mountBounds.error)
	}
	if (blocked) {
		const bounds = checkBounds(
			{ position_u: blocked.position_u, height_u: blocked.height_u },
			height,
			`Shelf "${name}"`,
		)
		if (Result.isError(bounds)) {
			return Result.err(bounds.error)
		}
	}
	// Overlap against every other occupant (devices + shelf blockers)
	// is checked by the caller with the real face/depth.
	return Result.ok(undefined)
}

/**
 * Validates a shelf mount with its real face/depth against all other
 * occupants. Split from `checkShelfBounds` so face/depth flow explicitly.
 */
async function checkShelfOverlap(
	name: string,
	rackId: number,
	face: 'front' | 'rear' | null,
	isFullDepth: boolean,
	positionU: number,
	mountHeight: number,
	mountUsable: boolean,
	reservedHeight: number,
	excludeShelfId?: number,
): Promise<Result<undefined, Error>> {
	const blocked = shelfBlockedRange({
		position_u: positionU,
		mount_height: mountHeight,
		mount_usable: mountUsable,
		reserved_height: reservedHeight,
	})
	if (!blocked) {
		return Result.ok(undefined)
	}
	const overlap = checkOverlap(
		{
			id: excludeShelfId === undefined ? 0 : -excludeShelfId,
			name,
			position_u: blocked.position_u,
			height_u: blocked.height_u,
			face,
			is_full_depth: isFullDepth,
		},
		await rackSpansOf(rackId),
		`Shelf "${name}"`,
		excludeShelfId === undefined ? undefined : -excludeShelfId,
	)
	if (Result.isError(overlap)) {
		return Result.err(overlap.error)
	}
	return Result.ok(undefined)
}

export async function createShelf(input: ShelfCreate): Promise<Result<ShelfRow, Error>> {
	const name = input.name ?? 'shelf'
	const mountHeight = input.mount_height ?? 1
	const mountUsable = input.mount_usable ?? false
	const reservedHeight = input.reserved_height ?? 0
	const bounds = await checkShelfBounds(
		name,
		input.rack_id,
		input.position_u,
		mountHeight,
		mountUsable,
		reservedHeight,
	)
	if (Result.isError(bounds)) {
		return Result.err(bounds.error)
	}
	const overlap = await checkShelfOverlap(
		name,
		input.rack_id,
		input.face ?? null,
		input.is_full_depth ?? true,
		input.position_u,
		mountHeight,
		mountUsable,
		reservedHeight,
	)
	if (Result.isError(overlap)) {
		return Result.err(overlap.error)
	}
	const row: Omit<ShelfRow, 'id'> = {
		rack_id: input.rack_id,
		name: input.name ?? null,
		face: input.face ?? null,
		position_u: input.position_u,
		mount_height: mountHeight,
		mount_usable: mountUsable ? 1 : 0,
		reserved_height: reservedHeight,
		is_full_depth: (input.is_full_depth ?? true) ? 1 : 0,
		description: input.description ?? null,
	}
	try {
		const inserted = (
			await getDb().insert(shelves).values(row).returning({ id: shelves.id })
		)[0]
		if (!inserted) {
			return Result.err(new Error('Shelf insert did not return an id'))
		}
		return await getShelf(inserted.id)
	} catch (err) {
		if (isUniqueViolation(err)) {
			return Result.err(new ConflictError('Shelf name is already in use'))
		}
		return Result.err(err instanceof Error ? err : new Error(String(err)))
	}
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
	const rackId = input.rack_id ?? node.rack_id
	const positionU = input.position_u ?? node.position_u
	const mountHeight = input.mount_height ?? node.mount_height
	const mountUsable = input.mount_usable ?? node.mount_usable !== 0
	const reservedHeight = input.reserved_height ?? node.reserved_height
	const face =
		input.face !== undefined
			? input.face
			: node.face === 'front' || node.face === 'rear'
				? node.face
				: null
	const isFullDepth = input.is_full_depth ?? node.is_full_depth !== 0
	// Devices on the shelf share its rack; moving it would strand them.
	if (input.rack_id !== undefined && input.rack_id !== node.rack_id) {
		const occupant = (
			await getDb().select().from(devices).where(eq(devices.shelf_id, id)).limit(1)
		)[0]
		if (occupant) {
			return Result.err(
				new ConflictError('Shelf still has devices; remove them before moving racks'),
			)
		}
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
		const bounds = await checkShelfBounds(
			input.name ?? node.name ?? 'shelf',
			rackId,
			positionU,
			mountHeight,
			mountUsable,
			reservedHeight,
		)
		if (Result.isError(bounds)) {
			return Result.err(bounds.error)
		}
		const overlap = await checkShelfOverlap(
			input.name ?? node.name ?? 'shelf',
			rackId,
			face,
			isFullDepth,
			positionU,
			mountHeight,
			mountUsable,
			reservedHeight,
			id,
		)
		if (Result.isError(overlap)) {
			return Result.err(overlap.error)
		}
	}
	const patch: Partial<ShelfRow> = {}
	if (input.name !== undefined) {
		patch.name = input.name
	}
	if (input.rack_id !== undefined) {
		patch.rack_id = input.rack_id
	}
	if (input.face !== undefined) {
		patch.face = input.face
	}
	if (input.position_u !== undefined) {
		patch.position_u = input.position_u
	}
	if (input.mount_height !== undefined) {
		patch.mount_height = input.mount_height
	}
	if (input.mount_usable !== undefined) {
		patch.mount_usable = input.mount_usable ? 1 : 0
	}
	if (input.reserved_height !== undefined) {
		patch.reserved_height = input.reserved_height
	}
	if (input.is_full_depth !== undefined) {
		patch.is_full_depth = input.is_full_depth ? 1 : 0
	}
	if (input.description !== undefined) {
		patch.description = input.description
	}
	if (!isPatchEmpty(patch)) {
		try {
			await getDb().update(shelves).set(patch).where(eq(shelves.id, id))
		} catch (err) {
			if (isUniqueViolation(err)) {
				return Result.err(new ConflictError('Shelf name is already in use'))
			}
			return Result.err(err instanceof Error ? err : new Error(String(err)))
		}
	}
	return await getShelf(id)
}

export async function deleteShelf(id: number): Promise<Result<ShelfRow, Error>> {
	const current = await getShelf(id)
	if (Result.isError(current)) {
		return current
	}
	// Devices on the shelf stay assigned to the rack, just unplaced.
	try {
		await getDb().transaction(async (tx) => {
			await tx.update(devices).set({ shelf_id: null }).where(eq(devices.shelf_id, id))
			await tx.delete(shelves).where(eq(shelves.id, id))
		})
	} catch (e) {
		return Result.err(errOf(e))
	}
	return Result.ok(current.value)
}
