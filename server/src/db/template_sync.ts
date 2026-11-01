import { Result } from 'better-result'
import { asc, eq, inArray, or } from 'drizzle-orm'
import { portKindsCompatible } from 'shared/src/ports'
import type { ExpandedInterface, TemplateSyncApply, TemplateSyncPreview } from 'shared/src/schemas'
import { cables, floorplan_placements, interfaces } from '../schema'
import { buildPreview, planSync, type SyncPlan } from '../services/template_sync'
import { expandStubs } from '../services/templates'
import { logCreate, logDelete, logUpdate } from './changelog'
import { getDb, withTransaction } from './connection'
import {
	getDevice,
	getInterface,
	type InterfaceJson,
	type InterfaceRow,
	listInterfaces,
	toInterfaceJson,
} from './devices'
import { ConflictError } from './errors'
import { insertedId, tryWrite } from './list'
import { stubsOf } from './templates'

/** Above any real position, so parked front ports never meet a real slot. */
const PARKED_POSITION = 1_000_000

const NAME_OR_SLOT_TAKEN = 'A kept port blocks a name or rear position of the device type'

interface SyncState {
	expected: ExpandedInterface[]
	ports: InterfaceRow[]
}

async function loadState(deviceId: number): Promise<Result<SyncState, Error>> {
	const device = await getDevice(deviceId)
	if (Result.isError(device)) {
		return device
	}
	const expected = expandStubs(await stubsOf(device.value.device_type_id))
	if (Result.isError(expected)) {
		return Result.err(new ConflictError(expected.error.message))
	}
	const ports = await getDb()
		.select()
		.from(interfaces)
		.where(eq(interfaces.device_id, deviceId))
		.orderBy(asc(interfaces.id))
	return Result.ok({ expected: expected.value, ports })
}

export async function getTemplateSync(
	deviceId: number,
): Promise<Result<TemplateSyncPreview, Error>> {
	const state = await loadState(deviceId)
	if (Result.isError(state)) {
		return state
	}
	return Result.ok(buildPreview(state.value.expected, state.value.ports))
}

/** A kind change must leave every cable on the device between compatible ports. */
async function checkCabledKinds(
	{ expected, ports }: SyncState,
	plan: SyncPlan,
): Promise<Result<undefined, Error>> {
	const ids = ports.map((port) => port.id)
	if (ids.length === 0) {
		return Result.ok(undefined)
	}
	const rows = await getDb()
		.select({ a: cables.a_interface_id, b: cables.b_interface_id })
		.from(cables)
		.where(or(inArray(cables.a_interface_id, ids), inArray(cables.b_interface_id, ids)))
	const kinds = new Map(ports.map((port) => [port.id, port.kind]))
	plan.slots.forEach((port, i) => {
		const kind = expected[i]?.kind
		if (port && kind !== undefined) {
			kinds.set(port.id, kind)
		}
	})
	const peers = rows.flatMap(({ a, b }) => [a, b]).filter((id) => !kinds.has(id))
	if (peers.length > 0) {
		const peerRows = await getDb()
			.select({ id: interfaces.id, kind: interfaces.kind })
			.from(interfaces)
			.where(inArray(interfaces.id, peers))
		for (const peer of peerRows) {
			kinds.set(peer.id, peer.kind)
		}
	}
	for (const { a, b } of rows) {
		if (!portKindsCompatible(kinds.get(a) ?? '', kinds.get(b) ?? '')) {
			const name = ports.find((port) => port.id === a || port.id === b)?.name ?? ''
			return Result.err(
				new ConflictError(
					`Interface ${name} would no longer fit its cable; disconnect it first`,
				),
			)
		}
	}
	return Result.ok(undefined)
}

/**
 * Rear slots are unique and front ports may trade them, so ports that move
 * step aside before any of them takes its final slot. Names need no such
 * step: a port is only renamed to a name no port of its side holds.
 */
async function parkMovingFronts({ expected }: SyncState, plan: SyncPlan): Promise<void> {
	for (const [i, port] of plan.slots.entries()) {
		const target = expected[i]
		if (!port || !target || port.rear_port_id === null) {
			continue
		}
		const rearId =
			target.rear_index === null ? null : (plan.slots[target.rear_index]?.id ?? null)
		if (port.rear_port_id !== rearId || port.rear_port_position !== target.rear_port_position) {
			await getDb()
				.update(interfaces)
				.set({ rear_port_position: PARKED_POSITION + port.id })
				.where(eq(interfaces.id, port.id))
		}
	}
}

/** Applies a plan and logs every touched port. Runs inside a transaction. */
async function writePlan(deviceId: number, state: SyncState, plan: SyncPlan): Promise<void> {
	const db = getDb()
	await parkMovingFronts(state, plan)
	// Expansion lists rear ports before the front ports that map onto them,
	// so their ids are known by then.
	const ids: number[] = []
	const created: number[] = []
	const updated: InterfaceRow[] = []
	for (const [i, target] of state.expected.entries()) {
		const port = plan.slots[i]
		const rearPortId = target.rear_index === null ? null : (ids[target.rear_index] ?? null)
		const fields = {
			name: target.name,
			kind: target.kind,
			description: target.description,
			positions: target.positions,
			rear_port_id: rearPortId,
			rear_port_position: target.rear_port_position,
		}
		if (!port) {
			const id = insertedId(
				await db
					.insert(interfaces)
					.values({ device_id: deviceId, connected: 0, side: target.side, ...fields })
					.returning({ id: interfaces.id }),
			)
			ids.push(id)
			created.push(id)
			continue
		}
		ids.push(port.id)
		if (
			Object.entries(fields).every(
				([key, value]) => port[key as keyof typeof fields] === value,
			)
		) {
			continue
		}
		// More than one position makes it a plain rear port, no longer an outlet.
		const outletLost = target.positions > 1 && port.positions === 1
		await db
			.update(interfaces)
			.set({ ...fields, ...(outletLost ? { location_id: null } : {}) })
			.where(eq(interfaces.id, port.id))
		if (outletLost) {
			await db
				.delete(floorplan_placements)
				.where(eq(floorplan_placements.interface_id, port.id))
		}
		updated.push(port)
	}
	if (plan.removed.length > 0) {
		// One statement: front and rear ports may go together (self reference).
		await db.delete(interfaces).where(
			inArray(
				interfaces.id,
				plan.removed.map((port) => port.id),
			),
		)
	}
	for (const port of plan.removed) {
		await logDelete('interface', toInterfaceJson(port))
	}
	for (const port of updated) {
		await logUpdate('interface', toInterfaceJson(port), await getInterface(deviceId, port.id))
	}
	for (const id of created) {
		await logCreate('interface', await getInterface(deviceId, id))
	}
}

/**
 * Brings a device's ports in line with its device type: matched ports take
 * the type's fields, orphaned ports follow their assignment, ports the
 * device lacks are created. Remapped ports keep their id, so cables,
 * floor plan placements, `enabled` and `patched` stay with them.
 */
export async function applyTemplateSync(
	deviceId: number,
	input: TemplateSyncApply,
): Promise<Result<InterfaceJson[], Error>> {
	const state = await loadState(deviceId)
	if (Result.isError(state)) {
		return state
	}
	const plan = planSync(state.value.expected, state.value.ports, input.assignments)
	if (Result.isError(plan)) {
		return Result.err(new ConflictError(plan.error.message))
	}
	const cabled = await checkCabledKinds(state.value, plan.value)
	if (Result.isError(cabled)) {
		return cabled
	}
	const written = await tryWrite(
		() => withTransaction(() => writePlan(deviceId, state.value, plan.value)),
		NAME_OR_SLOT_TAKEN,
	)
	if (Result.isError(written)) {
		return written
	}
	return listInterfaces(deviceId)
}
