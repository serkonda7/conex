/**
 * Jacks of a patch panel: single-position rear ports (outlets) grouped
 * behind one faceplate, e.g. a double jack with two ports. A jack belongs
 * to one panel; on a floor plan the jack
 * is placed instead of its ports (`attachments.ts`).
 */
import { Result } from 'better-result'
import { and, asc, eq, getTableColumns, inArray, notExists, type SQL, sql } from 'drizzle-orm'
import type { PanelJackCreate, PanelJackJson, PanelJackUpdate } from 'shared/src/schemas'
import { devices, floorplan_placements, interfaces, panel_jacks } from '../schema'
import { logCreate, logDelete, logUpdate } from './changelog'
import { getDb, withTransaction } from './connection'
import { getDevice } from './devices'
import { ConflictError, NotFoundError } from './errors'
import { exists, insertedId, subquery, tryWrite } from './list'

const NOT_FOUND = 'Jack not found'
const NAME_TAKEN = 'This panel already has a jack with this name'

/**
 * Jack columns plus the ids of its ports in port order, in one statement.
 * jsonb, not arrays: Bun's driver may return int arrays as `Int32Array`.
 */
const jackColumns: ReturnType<typeof getTableColumns<typeof panel_jacks>> & {
	interface_ids: SQL<number[]>
} = {
	...getTableColumns(panel_jacks),
	interface_ids: sql<number[]>`coalesce((${subquery
		.select({ list: sql`jsonb_agg(${interfaces.id} order by ${interfaces.id})` })
		.from(interfaces)
		.where(eq(interfaces.jack_id, panel_jacks.id))}), '[]'::jsonb)`,
}

async function getJack(deviceId: number, jackId: number): Promise<Result<PanelJackJson, Error>> {
	const [row] = await getDb()
		.select(jackColumns)
		.from(panel_jacks)
		.where(and(eq(panel_jacks.id, jackId), eq(panel_jacks.device_id, deviceId)))
	return row ? Result.ok(row) : Result.err(new NotFoundError(NOT_FOUND))
}

/** Jacks of a panel in port order (by their first port). */
export async function listJacks(deviceId: number): Promise<Result<PanelJackJson[], Error>> {
	if (!(await exists(devices, eq(devices.id, deviceId)))) {
		return Result.err(new NotFoundError('Device not found'))
	}
	const jacks = await getDb()
		.select(jackColumns)
		.from(panel_jacks)
		.where(eq(panel_jacks.device_id, deviceId))
	return Result.ok(
		jacks.sort((a, b) => (a.interface_ids[0] ?? Infinity) - (b.interface_ids[0] ?? Infinity)),
	)
}

/**
 * Groups outlets of a panel into a new jack (`PanelJackCreateSchema`) with
 * one changelog entry for the jack.
 */
export async function createJack(
	deviceId: number,
	input: PanelJackCreate,
): Promise<Result<PanelJackJson, Error>> {
	const device = await getDevice(deviceId)
	if (Result.isError(device)) {
		return device
	}
	const ids = [...new Set(input.interface_ids)]
	if (ids.length < 2) {
		return Result.err(new ConflictError('A jack needs at least two ports'))
	}
	const ports = await getDb()
		.select()
		.from(interfaces)
		.where(and(eq(interfaces.device_id, deviceId), inArray(interfaces.id, ids)))
		.orderBy(asc(interfaces.id))
	if (ports.length < ids.length) {
		return Result.err(new NotFoundError('Interface not found on this device'))
	}
	for (const port of ports) {
		if (port.side !== 'rear' || port.positions !== 1) {
			return Result.err(
				new ConflictError(
					`Port ${port.name} is not an outlet (a single-position rear port)`,
				),
			)
		}
		if (port.jack_id !== null) {
			return Result.err(new ConflictError(`Port ${port.name} is already in a jack`))
		}
	}
	const written = await tryWrite(
		() =>
			withTransaction(async () => {
				const jackId = insertedId(
					await getDb()
						.insert(panel_jacks)
						.values({ device_id: deviceId, name: input.name })
						.returning({ id: panel_jacks.id }),
				)
				await getDb()
					.update(interfaces)
					.set({ jack_id: jackId })
					.where(inArray(interfaces.id, ids))
				// The first placed port's marker becomes the jack's.
				const placed = await getDb()
					.select()
					.from(floorplan_placements)
					.where(inArray(floorplan_placements.interface_id, ids))
					.orderBy(asc(floorplan_placements.interface_id))
				const [first] = placed
				if (first) {
					await getDb()
						.delete(floorplan_placements)
						.where(inArray(floorplan_placements.interface_id, ids))
					await getDb().insert(floorplan_placements).values({
						attachment_id: first.attachment_id,
						jack_id: jackId,
						x: first.x,
						y: first.y,
					})
				}
				return jackId
			}),
		NAME_TAKEN,
	)
	if (Result.isError(written)) {
		return written
	}
	return await logCreate('panel_jack', await getJack(deviceId, written.value))
}

export async function updateJack(
	deviceId: number,
	jackId: number,
	input: PanelJackUpdate,
): Promise<Result<PanelJackJson, Error>> {
	const current = await getJack(deviceId, jackId)
	if (Result.isError(current)) {
		return current
	}
	const written = await tryWrite(
		() =>
			getDb().update(panel_jacks).set({ name: input.name }).where(eq(panel_jacks.id, jackId)),
		NAME_TAKEN,
	)
	if (Result.isError(written)) {
		return written
	}
	return await logUpdate('panel_jack', current.value, await getJack(deviceId, jackId))
}

/**
 * Ungroups a jack: its ports stay as single outlets;
 * its floor-plan marker is removed.
 */
export async function deleteJack(
	deviceId: number,
	jackId: number,
): Promise<Result<PanelJackJson, Error>> {
	const current = await getJack(deviceId, jackId)
	if (Result.isError(current)) {
		return current
	}
	const deleted = await tryWrite(() =>
		withTransaction(async () => {
			await getDb()
				.update(interfaces)
				.set({ jack_id: null })
				.where(eq(interfaces.jack_id, jackId))
			await getDb().delete(panel_jacks).where(eq(panel_jacks.id, jackId))
		}),
	)
	if (Result.isError(deleted)) {
		return deleted
	}
	return await logDelete('panel_jack', current.value)
}

/**
 * Removes a panel's jacks left without ports (their ports were deleted or
 * stopped being outlets), with their markers. Runs on the caller's `getDb()`.
 */
export async function removeEmptyJacks(deviceId: number): Promise<void> {
	await getDb()
		.delete(panel_jacks)
		.where(
			and(
				eq(panel_jacks.device_id, deviceId),
				notExists(
					getDb()
						.select({ id: interfaces.id })
						.from(interfaces)
						.where(eq(interfaces.jack_id, panel_jacks.id)),
				),
			),
		)
}
