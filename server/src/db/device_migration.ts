import { Result } from 'better-result'
import { and, eq, inArray, or } from 'drizzle-orm'
import { portsCompatible } from 'shared/src/ports'
import type { DeviceMigrate } from 'shared/src/schemas'
import {
	cables,
	device_employees,
	device_roles,
	devices,
	floorplan_areas,
	floorplan_drawing_placements,
	floorplan_placements,
	interfaces,
	racks,
	virtual_machines,
} from '../schema'
import { checkBounds, checkOverlap, faceOf } from '../services/occupancy'
import { prunePlacements } from './attachments'
import { type CableRow, deviceHasCables } from './cables'
import { type Change, logChanges, updateChanges } from './changelog'
import { getDb, withTransaction } from './connection'
import { type DeviceRow, getDevice, type InterfaceRow } from './devices'
import { ConflictError, NotFoundError, ValidationError } from './errors'
import { findOne, isPatchEmpty, tryWrite } from './list'
import { rackHeightOf, rackSpansOf } from './racks'
import { getDeviceType } from './templates'
import { retenantHostedVms, type VirtualMachineRow } from './virtual_machines'

type DeviceColumns = typeof devices.$inferSelect

/** A cable and the interfaces its ends move to. */
interface CableMove {
	cable: CableRow
	a_interface_id: number
	b_interface_id: number
}

/** Ports of a device by id. */
async function portsOf(deviceId: number): Promise<Map<number, InterfaceRow>> {
	const rows = await getDb().select().from(interfaces).where(eq(interfaces.device_id, deviceId))
	return new Map(rows.map((row) => [row.id, row]))
}

function cablesTouching(ids: number[]): Promise<CableRow[]> {
	return getDb()
		.select()
		.from(cables)
		.where(or(inArray(cables.a_interface_id, ids), inArray(cables.b_interface_id, ids)))
}

/**
 * Checks the port mapping and returns the cables it moves with their new
 * ends. Each old port needs a cable, each new port must be free and
 * patched, and every moved cable must still join compatible ports (kinds,
 * not one pass-through), also when both of its ends move.
 */
async function planCables(
	sourceId: number,
	targetId: number,
	pairs: DeviceMigrate['ports'],
): Promise<Result<CableMove[], Error>> {
	if (pairs.length === 0) {
		return Result.ok([])
	}
	const [sourcePorts, targetPorts] = [await portsOf(sourceId), await portsOf(targetId)]
	const mapping = new Map<number, InterfaceRow>()
	for (const pair of pairs) {
		const from = sourcePorts.get(pair.from)
		if (!from) {
			return Result.err(new NotFoundError('Port not found on the old device'))
		}
		const to = targetPorts.get(pair.to)
		if (!to) {
			return Result.err(new NotFoundError('Port not found on the new device'))
		}
		if (to.patched === 0) {
			return Result.err(new ConflictError(`Interface ${to.name} is not patched`))
		}
		if (to.connected !== 0) {
			return Result.err(new ConflictError(`Interface ${to.name} is already connected`))
		}
		mapping.set(from.id, to)
	}
	const [taken] = await cablesTouching(pairs.map((pair) => pair.to))
	if (taken) {
		const port = targetPorts.get(taken.a_interface_id) ?? targetPorts.get(taken.b_interface_id)
		return Result.err(new ConflictError(`Interface ${port?.name ?? ''} is already connected`))
	}
	const moving = await cablesTouching(pairs.map((pair) => pair.from))
	for (const pair of pairs) {
		if (!moving.some((c) => c.a_interface_id === pair.from || c.b_interface_id === pair.from)) {
			const name = sourcePorts.get(pair.from)?.name ?? ''
			return Result.err(new ConflictError(`Interface ${name} has no cable`))
		}
	}
	// Far ends on other devices, for the compatibility check.
	const known = new Map([...sourcePorts, ...targetPorts])
	const peerIds = moving
		.flatMap((c) => [c.a_interface_id, c.b_interface_id])
		.filter((id) => !known.has(id))
	if (peerIds.length > 0) {
		const peers = await getDb().select().from(interfaces).where(inArray(interfaces.id, peerIds))
		for (const peer of peers) {
			known.set(peer.id, peer)
		}
	}
	const endOf = (id: number): InterfaceRow | undefined => mapping.get(id) ?? known.get(id)
	const moves: CableMove[] = []
	for (const cable of moving) {
		const a = endOf(cable.a_interface_id)
		const b = endOf(cable.b_interface_id)
		if (!a || !b) {
			return Result.err(new NotFoundError('Interface not found'))
		}
		if (!portsCompatible(a, b)) {
			const moved = mapping.has(cable.a_interface_id) ? a : b
			const peer = moved === a ? b : a
			return Result.err(
				new ConflictError(`Interface ${moved.name} does not fit the cable to ${peer.name}`),
			)
		}
		moves.push({ cable, a_interface_id: a.id, b_interface_id: b.id })
	}
	return Result.ok(moves)
}

/**
 * Placement the replacement takes over: the old device's site, location and
 * rack mount or shelf. A U mount must fit the replacement's height where the
 * old device leaves its U free.
 */
async function planPlacement(
	source: DeviceRow,
	target: DeviceRow,
): Promise<Result<Partial<DeviceColumns>, Error>> {
	const placement: Partial<DeviceColumns> = {
		site_id: source.site_id,
		location_id: source.location_id,
		rack_id: source.rack_id,
		face: source.face,
		position_u: source.position_u,
		shelf_id: source.shelf_id,
	}
	if (source.rack_id === null || source.position_u === null) {
		return Result.ok(placement)
	}
	const type = await getDeviceType(target.device_type_id)
	if (Result.isError(type)) {
		return type
	}
	if (type.value.u_height < 1) {
		return Result.err(
			new ConflictError(
				"The new device's type takes no rack units, so it cannot take over the rack mount",
			),
		)
	}
	const rack = await findOne(racks, eq(racks.id, source.rack_id))
	if (!rack) {
		return Result.err(new NotFoundError('Rack not found'))
	}
	const label = `Device "${target.name}"`
	const candidate = {
		id: target.id,
		name: target.name,
		position_u: source.position_u,
		height_u: type.value.u_height,
		face: faceOf(source.face),
		is_full_depth: type.value.is_full_depth,
	}
	const bounds = checkBounds(candidate, await rackHeightOf(rack), label)
	if (Result.isError(bounds)) {
		return bounds
	}
	const spans = (await rackSpansOf(source.rack_id)).filter((span) => span.id !== source.id)
	const overlap = checkOverlap(candidate, spans, label, target.id)
	return Result.isError(overlap) ? overlap : Result.ok(placement)
}

/** Checks that the replacement can host the old device's VMs; returns them. */
async function planVms(
	source: DeviceRow,
	target: DeviceRow,
): Promise<Result<VirtualMachineRow[], Error>> {
	const hosted = await getDb()
		.select()
		.from(virtual_machines)
		.where(eq(virtual_machines.host_device_id, source.id))
	if (hosted.length === 0) {
		return Result.ok([])
	}
	const role = await findOne(device_roles, eq(device_roles.id, target.device_role_id))
	if (role?.can_host_vms !== 1) {
		return Result.err(new ValidationError("The new device's role cannot host virtual machines"))
	}
	const [clash] = await getDb()
		.select({ name: virtual_machines.name })
		.from(virtual_machines)
		.where(
			and(
				eq(virtual_machines.host_device_id, target.id),
				inArray(
					virtual_machines.name,
					hosted.map((vm) => vm.name),
				),
			),
		)
		.limit(1)
	if (clash) {
		return Result.err(
			new ConflictError(
				`The new device already runs a virtual machine named "${clash.name}"`,
			),
		)
	}
	return Result.ok(hosted)
}

/**
 * Hands the old device's floor-plan markers and areas to the replacement,
 * image and drawn plans apart: where the old device has one, the
 * replacement's own goes (a device lies on at most one plan of each).
 * Runs on the caller's transaction.
 */
async function moveFloorplanMarkers(sourceId: number, targetId: number): Promise<void> {
	const db = getDb()
	const onImagePlan =
		(await db.$count(floorplan_placements, eq(floorplan_placements.device_id, sourceId))) +
			(await db.$count(floorplan_areas, eq(floorplan_areas.device_id, sourceId))) >
		0
	if (onImagePlan) {
		await db.delete(floorplan_placements).where(eq(floorplan_placements.device_id, targetId))
		await db.delete(floorplan_areas).where(eq(floorplan_areas.device_id, targetId))
		await db
			.update(floorplan_placements)
			.set({ device_id: targetId })
			.where(eq(floorplan_placements.device_id, sourceId))
		await db
			.update(floorplan_areas)
			.set({ device_id: targetId })
			.where(eq(floorplan_areas.device_id, sourceId))
	}
	const drawn = floorplan_drawing_placements.device_id
	if ((await db.$count(floorplan_drawing_placements, eq(drawn, sourceId))) > 0) {
		await db.delete(floorplan_drawing_placements).where(eq(drawn, targetId))
		await db
			.update(floorplan_drawing_placements)
			.set({ device_id: targetId })
			.where(eq(drawn, sourceId))
	}
}

/** Moves cables to their new ends and flips `connected` on the ports they leave and reach. */
async function writeCables(moves: CableMove[], pairs: DeviceMigrate['ports']): Promise<void> {
	if (moves.length === 0) {
		return
	}
	const db = getDb()
	for (const move of moves) {
		await db
			.update(cables)
			.set({ a_interface_id: move.a_interface_id, b_interface_id: move.b_interface_id })
			.where(eq(cables.id, move.cable.id))
	}
	await db
		.update(interfaces)
		.set({ connected: 0 })
		.where(
			inArray(
				interfaces.id,
				pairs.map((pair) => pair.from),
			),
		)
	await db
		.update(interfaces)
		.set({ connected: 1 })
		.where(
			inArray(
				interfaces.id,
				pairs.map((pair) => pair.to),
			),
		)
}

/** Placement fields of a device that is in no rack, site or location. */
const UNPLACED: Partial<DeviceColumns> = {
	site_id: null,
	location_id: null,
	rack_id: null,
	face: null,
	position_u: null,
	shelf_id: null,
}

/** Rack fields of a device that leaves its rack but stays at its site and location. */
const UNRACKED: Partial<DeviceColumns> = {
	rack_id: null,
	face: null,
	position_u: null,
	shelf_id: null,
}

/**
 * Migrates a device to its replacement (e.g. a new switch or PC) in one
 * transaction, as chosen in `input`: cables move port by port, then
 * placement (the old device leaves its rack, its floor-plan markers go
 * along), tenant and employees, hosted VMs and the name; the old device
 * takes the new `status`. Both devices must end up in the same tenant, as
 * cables, racks and VMs never cross tenants. A replacement that changes
 * tenant without taking over the placement leaves its own placement, like
 * a tenant move does, and must have no cables of its own.
 */
export async function migrateDevice(
	sourceId: number,
	input: DeviceMigrate,
): Promise<Result<DeviceRow, Error>> {
	if (input.target_id === sourceId) {
		return Result.err(new ConflictError('A device cannot be migrated to itself'))
	}
	const sourceRow = await getDevice(sourceId)
	if (Result.isError(sourceRow)) {
		return sourceRow
	}
	const targetRow = await getDevice(input.target_id)
	if (Result.isError(targetRow)) {
		return Result.err(new NotFoundError('New device not found'))
	}
	const source = sourceRow.value
	const target = targetRow.value
	const tenantId = input.assignment ? source.tenant_id : target.tenant_id
	if (tenantId !== source.tenant_id) {
		return Result.err(
			new ConflictError(
				'The new device belongs to another tenant; take over the tenant to migrate',
			),
		)
	}
	const retenant = tenantId !== target.tenant_id
	if (retenant && (await deviceHasCables(target.id))) {
		return Result.err(
			new ConflictError(
				'The new device has cables in its current tenant; disconnect them first',
			),
		)
	}
	const cableMoves = await planCables(source.id, target.id, input.ports)
	if (Result.isError(cableMoves)) {
		return cableMoves
	}
	const targetPatch: Partial<DeviceColumns> = {}
	const sourcePatch: Partial<DeviceColumns> = {}
	if (input.placement) {
		const placement = await planPlacement(source, target)
		if (Result.isError(placement)) {
			return placement
		}
		Object.assign(targetPatch, placement.value)
		Object.assign(sourcePatch, UNRACKED)
	} else if (retenant) {
		Object.assign(targetPatch, UNPLACED)
	}
	const vms = input.vms ? await planVms(source, target) : Result.ok([])
	if (Result.isError(vms)) {
		return vms
	}
	if (retenant) {
		targetPatch.tenant_id = tenantId
	}
	if (input.name) {
		targetPatch.name = source.name
	}
	if (input.status !== undefined) {
		sourcePatch.status = input.status
	}
	const written = await tryWrite(() =>
		withTransaction(async () => {
			const db = getDb()
			await writeCables(cableMoves.value, input.ports)
			if (input.assignment) {
				// Dropped before the tenant changes: the change cascades to kept
				// assignments, which must stay members of the tenant.
				await db.delete(device_employees).where(eq(device_employees.device_id, target.id))
			}
			if (!isPatchEmpty(sourcePatch)) {
				await db.update(devices).set(sourcePatch).where(eq(devices.id, source.id))
			}
			if (!isPatchEmpty(targetPatch)) {
				await db.update(devices).set(targetPatch).where(eq(devices.id, target.id))
			}
			if (input.assignment) {
				await db.delete(device_employees).where(eq(device_employees.device_id, source.id))
				if (tenantId !== null && source.employee_ids.length > 0) {
					await db.insert(device_employees).values(
						source.employee_ids.map((employee_id) => ({
							device_id: target.id,
							employee_id,
							tenant_id: tenantId,
						})),
					)
				}
			}
			if (retenant) {
				// Before the old device's VMs arrive: they keep their employees.
				await retenantHostedVms(target.id, tenantId)
			}
			if (vms.value.length > 0) {
				await db
					.update(virtual_machines)
					.set({ host_device_id: target.id })
					.where(eq(virtual_machines.host_device_id, source.id))
			}
			if (input.placement) {
				await moveFloorplanMarkers(source.id, target.id)
			}
			if (input.placement || retenant) {
				await prunePlacements()
			}
		}),
	)
	if (Result.isError(written)) {
		return written
	}
	const after = await getDevice(target.id)
	const sourceAfter = await getDevice(source.id)
	const changes: Change[] = [
		...updateChanges(
			'cable',
			cableMoves.value.map(({ cable, ...ends }): [CableRow, CableRow] => [
				cable,
				{ ...cable, ...ends },
			]),
		),
		...updateChanges('device', [
			...(Result.isOk(sourceAfter)
				? [[source, sourceAfter.value] as [DeviceRow, DeviceRow]]
				: []),
			...(Result.isOk(after) ? [[target, after.value] as [DeviceRow, DeviceRow]] : []),
		]),
		...updateChanges(
			'virtual_machine',
			vms.value.map((vm): [VirtualMachineRow, VirtualMachineRow] => [
				vm,
				{ ...vm, host_device_id: target.id },
			]),
		),
	]
	await logChanges(changes)
	return after
}
