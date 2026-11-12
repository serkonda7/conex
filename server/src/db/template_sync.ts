import { Result } from 'better-result'
import { and, asc, eq, inArray, or, sql } from 'drizzle-orm'
import { portKindsCompatible } from 'shared/src/ports'
import type { ExpandedInterface, TemplateSyncApply, TemplateSyncPreview } from 'shared/src/schemas'
import { cables, floorplan_placements, interfaces } from '../schema'
import { buildPreview, planSync, type SyncPlan } from '../services/template_sync'
import { expandStubs } from '../services/templates'
import { createChanges, deleteChanges, logChanges, updateChanges } from './changelog'
import { getDb, withTransaction } from './connection'
import {
	getDevice,
	type InterfaceJson,
	type InterfaceRow,
	insertPorts,
	listInterfaces,
	toInterfaceJson,
} from './devices'
import { ConflictError } from './errors'
import { removeEmptyJacks } from './jacks'
import { tryWrite } from './list'
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
	const ids = state.value.ports.map((port) => port.id)
	const placements = await getDb()
		.select({ id: floorplan_placements.interface_id })
		.from(floorplan_placements)
		.where(inArray(floorplan_placements.interface_id, ids))
	const placed = new Set(placements.flatMap((row) => row.id ?? []))
	return Result.ok(buildPreview(state.value.expected, state.value.ports, placed))
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
	const moving: number[] = []
	for (const [i, port] of plan.slots.entries()) {
		const target = expected[i]
		if (!port || !target || port.rear_port_id === null) {
			continue
		}
		const rearId =
			target.rear_index === null ? null : (plan.slots[target.rear_index]?.id ?? null)
		if (port.rear_port_id !== rearId || port.rear_port_position !== target.rear_port_position) {
			moving.push(port.id)
		}
	}
	if (moving.length > 0) {
		await getDb()
			.update(interfaces)
			.set({ rear_port_position: sql`${PARKED_POSITION} + ${interfaces.id}` })
			.where(inArray(interfaces.id, moving))
	}
}

type PortFields = Pick<
	InterfaceRow,
	'name' | 'template_name' | 'kind' | 'positions' | 'rear_port_id' | 'rear_port_position'
>

/** Applies a plan and logs every touched port. Runs inside a transaction. */
async function writePlan(deviceId: number, state: SyncState, plan: SyncPlan): Promise<void> {
	const db = getDb()
	await parkMovingFronts(state, plan)
	const fieldsOf = (i: number, rearPortId: number | null): PortFields => {
		const target = state.expected[i] as ExpandedInterface
		const port = plan.slots[i]
		const linked = port !== null && port !== undefined && plan.linked.has(port.id)
		return {
			name: linked ? port.name : target.name,
			template_name: linked ? target.name : null,
			kind: target.kind,
			positions: target.positions,
			rear_port_id: rearPortId,
			rear_port_position: target.rear_port_position,
		}
	}
	// Expansion lists rear ports before the front ports that map onto them:
	// new ports without a rear port go in first, so every port's rear id is
	// known before the updates and the new front ports.
	const ids: (number | null)[] = plan.slots.map((port) => port?.id ?? null)
	const createdAt = (front: boolean): number[] =>
		state.expected.flatMap((target, i) =>
			!plan.slots[i] && (target.rear_index !== null) === front ? [i] : [],
		)
	const rearOf = (i: number): number | null => {
		const rearIndex = state.expected[i]?.rear_index ?? null
		return rearIndex === null ? null : (ids[rearIndex] ?? null)
	}
	const insertAt = async (indexes: number[]): Promise<void> => {
		const inserted = await insertPorts(
			db,
			deviceId,
			indexes.map((i) => ({
				side: state.expected[i]?.side ?? null,
				...fieldsOf(i, rearOf(i)),
			})),
		)
		indexes.forEach((i, n) => {
			ids[i] = inserted[n] ?? null
		})
	}
	const plainCreated = createdAt(false)
	const frontCreated = createdAt(true)
	await insertAt(plainCreated)
	const updated: InterfaceRow[] = []
	const unplaced: number[] = []
	for (const [i, port] of plan.slots.entries()) {
		if (!port) {
			continue
		}
		const fields = fieldsOf(i, rearOf(i))
		if (
			Object.entries(fields).every(([key, value]) => port[key as keyof PortFields] === value)
		) {
			continue
		}
		// More than one position makes it a plain rear port, no longer an outlet.
		const outletLost = fields.positions > 1 && port.positions === 1
		await db
			.update(interfaces)
			.set({ ...fields, ...(outletLost ? { jack_id: null } : {}) })
			.where(eq(interfaces.id, port.id))
		if (outletLost) {
			unplaced.push(port.id)
		}
		updated.push(port)
	}
	if (unplaced.length > 0) {
		await db
			.delete(floorplan_placements)
			.where(inArray(floorplan_placements.interface_id, unplaced))
	}
	await insertAt(frontCreated)
	if (plan.removed.length > 0) {
		// One statement: front and rear ports may go together (self reference).
		await db.delete(interfaces).where(
			inArray(
				interfaces.id,
				plan.removed.map((port) => port.id),
			),
		)
	}
	await removeEmptyJacks(deviceId)
	const created = [...plainCreated, ...frontCreated].flatMap((i) => ids[i] ?? [])
	const touched = [...updated.map((port) => port.id), ...created]
	const rows =
		touched.length === 0
			? []
			: await db
					.select()
					.from(interfaces)
					.where(and(eq(interfaces.device_id, deviceId), inArray(interfaces.id, touched)))
	const after = new Map(rows.map((row) => [row.id, toInterfaceJson(row)]))
	await logChanges([
		...deleteChanges('interface', plan.removed.map(toInterfaceJson)),
		...updateChanges(
			'interface',
			updated.flatMap((port): [InterfaceJson, InterfaceJson][] => {
				const row = after.get(port.id)
				return row ? [[toInterfaceJson(port), row]] : []
			}),
		),
		...createChanges(
			'interface',
			created.flatMap((id) => after.get(id) ?? []),
		),
	])
}

/**
 * Brings a device's ports in line with its device type: matched ports take
 * the type's fields (a linked port keeps its name), orphaned ports follow
 * their assignment, ports the device lacks are created. Remapped ports keep their id, so cables,
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
