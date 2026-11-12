/**
 * Jacks of a patch panel: single-position rear ports (outlets) grouped
 * behind one faceplate, e.g. a double jack with two ports. A jack belongs
 * to one panel and its ports share one location; on a floor plan the jack
 * is placed instead of its ports (`attachments.ts`).
 */
import { Result } from 'better-result'
import { and, asc, eq, getTableColumns, inArray, notExists, or, type SQL, sql } from 'drizzle-orm'
import type { PanelJackCreate, PanelJackJson, PanelJackUpdate } from 'shared/src/schemas'
import { devices, floorplan_placements, interfaces, panel_jacks } from '../schema'
import { inferOutletLocations } from './attachments'
import { logCreate, logDelete, logUpdate, logUpdates } from './changelog'
import { getDb, withTransaction } from './connection'
import { getDevice, type InterfaceJson, toInterfaceJson } from './devices'
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

type PortRow = typeof interfaces.$inferSelect

/**
 * The outlets `ids` of a panel for jack `jackId` (null for a new jack), in
 * port order, checked to be free or in that jack. When neither the jack nor
 * one of the ports is placed, the ports must agree on their location:
 * `location_id` is the jack's then, else `undefined` (its floor plan sets it).
 */
async function jackPorts(
	deviceId: number,
	ids: number[],
	jackId: number | null,
): Promise<Result<{ ports: PortRow[]; location_id: number | null | undefined }, Error>> {
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
		if (port.jack_id !== null && port.jack_id !== jackId) {
			return Result.err(new ConflictError(`Port ${port.name} is already in a jack`))
		}
	}
	// A placed port or jack sets the location from its floor plan
	// (`inferOutletLocations`); else the ports must agree on theirs.
	const placed = await exists(
		floorplan_placements,
		jackId === null
			? inArray(floorplan_placements.interface_id, ids)
			: or(
					inArray(floorplan_placements.interface_id, ids),
					eq(floorplan_placements.jack_id, jackId),
				),
	)
	if (placed) {
		return Result.ok({ ports, location_id: undefined })
	}
	const locationIds = new Set(ports.flatMap((port) => port.location_id ?? []))
	if (locationIds.size > 1) {
		return Result.err(new ConflictError('The ports lie in different locations'))
	}
	return Result.ok({ ports, location_id: [...locationIds][0] ?? null })
}

/**
 * Moves the checked `ports` into jack `jackId` (all of them, its existing
 * ones included) with their floor-plan markers and location: an unplaced
 * jack takes the first placed new port's marker, the other port markers are
 * removed; a placed jack's ports take the location from its plan, an
 * unplaced one's `locationId`. Runs on the caller's `getDb()`.
 */
async function fillJack(
	jackId: number,
	ports: PortRow[],
	locationId: number | null | undefined,
): Promise<void> {
	const added = ports.filter((port) => port.jack_id !== jackId).map((port) => port.id)
	if (added.length > 0) {
		await getDb()
			.update(interfaces)
			.set({ jack_id: jackId })
			.where(inArray(interfaces.id, added))
	}
	if (locationId !== undefined) {
		const ids = ports.map((port) => port.id)
		await getDb()
			.update(interfaces)
			.set({ location_id: locationId })
			.where(inArray(interfaces.id, ids))
		await logUpdates(
			'interface',
			ports
				.filter((port) => port.location_id !== locationId)
				.map((port): [InterfaceJson, InterfaceJson] => {
					const before = toInterfaceJson(port)
					return [before, { ...before, location_id: locationId }]
				}),
		)
		return
	}
	if (added.length > 0) {
		const [first] = await getDb()
			.select()
			.from(floorplan_placements)
			.where(inArray(floorplan_placements.interface_id, added))
			.orderBy(asc(floorplan_placements.interface_id))
			.limit(1)
		if (first) {
			await getDb()
				.delete(floorplan_placements)
				.where(inArray(floorplan_placements.interface_id, added))
			if (!(await exists(floorplan_placements, eq(floorplan_placements.jack_id, jackId)))) {
				await getDb().insert(floorplan_placements).values({
					attachment_id: first.attachment_id,
					jack_id: jackId,
					x: first.x,
					y: first.y,
				})
			}
		}
	}
	const [marker] = await getDb()
		.select({ attachment_id: floorplan_placements.attachment_id })
		.from(floorplan_placements)
		.where(eq(floorplan_placements.jack_id, jackId))
	if (marker) {
		await inferOutletLocations([marker.attachment_id])
	}
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
	const checked = await jackPorts(deviceId, [...new Set(input.interface_ids)], null)
	if (Result.isError(checked)) {
		return checked
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
				await fillJack(jackId, checked.value.ports, checked.value.location_id)
				return jackId
			}),
		NAME_TAKEN,
	)
	if (Result.isError(written)) {
		return written
	}
	return await logCreate('panel_jack', await getJack(deviceId, written.value))
}

/**
 * Renames a jack and/or sets its ports (`PanelJackUpdateSchema`): added
 * outlets join it as on create, removed ones stay as single, unplaced
 * outlets with their location. One changelog entry for the jack.
 */
export async function updateJack(
	deviceId: number,
	jackId: number,
	input: PanelJackUpdate,
): Promise<Result<PanelJackJson, Error>> {
	const current = await getJack(deviceId, jackId)
	if (Result.isError(current)) {
		return current
	}
	const ids = input.interface_ids ? [...new Set(input.interface_ids)] : null
	const checked = ids ? await jackPorts(deviceId, ids, jackId) : null
	if (checked && Result.isError(checked)) {
		return checked
	}
	const written = await tryWrite(
		() =>
			withTransaction(async () => {
				if (input.name !== undefined) {
					await getDb()
						.update(panel_jacks)
						.set({ name: input.name })
						.where(eq(panel_jacks.id, jackId))
				}
				if (ids && checked) {
					const removed = current.value.interface_ids.filter((id) => !ids.includes(id))
					if (removed.length > 0) {
						await getDb()
							.update(interfaces)
							.set({ jack_id: null })
							.where(inArray(interfaces.id, removed))
					}
					await fillJack(jackId, checked.value.ports, checked.value.location_id)
				}
			}),
		NAME_TAKEN,
	)
	if (Result.isError(written)) {
		return written
	}
	return await logUpdate('panel_jack', current.value, await getJack(deviceId, jackId))
}

/**
 * Ungroups a jack: its ports stay as single outlets with their location;
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
