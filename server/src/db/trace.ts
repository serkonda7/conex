import { Result } from 'better-result'
import { and, eq, inArray, isNotNull, or } from 'drizzle-orm'
import { type AnyPgColumn, alias } from 'drizzle-orm/pg-core'
import type {
	CableTraceResponse,
	DeviceTraceResponse,
	InterfaceTraceResponse,
	TraceEndToEnd,
	TraceHop,
	TraceLink,
	TracePanelPass,
	TracePath,
	TracePeerDevice,
	TracePeerInterface,
} from 'shared/src/schemas'
import { cables, devices, interfaces } from '../schema'
import { getDb } from './connection'
import { NotFoundError } from './errors'
import { exists, scopeCondition, subquery } from './list'

/** The columns a trace reads of each table. */
type DeviceRow = { id: number; name: string }
type InterfaceRow = Pick<
	typeof interfaces.$inferSelect,
	| 'id'
	| 'device_id'
	| 'name'
	| 'kind'
	| 'side'
	| 'rear_port_id'
	| 'rear_port_position'
	| 'positions'
>
type CableRow = Pick<
	typeof cables.$inferSelect,
	'id' | 'label' | 'status' | 'a_interface_id' | 'b_interface_id'
>

const aEnd = alias(interfaces, 'a_end')
const bEnd = alias(interfaces, 'b_end')
const aEndDevice = alias(devices, 'a_device')
const bEndDevice = alias(devices, 'b_device')

interface AdjEntry {
	cable: CableRow
	localIface: InterfaceRow
	peerIface: InterfaceRow
	peerDeviceId: number
}

const MAX_TRACE_PATHS = 200

/** Bound on pass-throughs followed for one end-to-end peer (guards cabling loops). */
const MAX_PANEL_PASSES = 32

function peerDeviceOf(row: DeviceRow): TracePeerDevice {
	return { id: row.id, name: row.name }
}

function peerIfaceOf(row: InterfaceRow): TracePeerInterface {
	return { id: row.id, name: row.name, kind: row.kind, side: row.side }
}

interface Graph {
	deviceById: Map<number, DeviceRow>
	ifaceById: Map<number, InterfaceRow>
	cableById: Map<number, CableRow>
	adj: Map<number, AdjEntry[]>
	/** Cable leaving each cabled port, seen from that port. */
	cableOf: Map<number, AdjEntry>
	/** Front port per rear-port slot (`rearId:position`). */
	frontBySlot: Map<string, InterfaceRow>
}

type IfaceColumn = keyof InterfaceRow

/** Interface columns a trace reads, for a select over `table` (or an alias of it). */
function ifaceColumns<T extends Record<IfaceColumn, AnyPgColumn>>(table: T): Pick<T, IfaceColumn> {
	return {
		id: table.id,
		device_id: table.device_id,
		name: table.name,
		kind: table.kind,
		side: table.side,
		rear_port_id: table.rear_port_id,
		rear_port_position: table.rear_port_position,
		positions: table.positions,
	}
}

/** A visible cable with both end ports and the names of their devices. */
interface LoadedCable {
	cable: CableRow
	a: InterfaceRow
	b: InterfaceRow
	aDevice: DeviceRow
	bDevice: DeviceRow
}

/**
 * Cables of the `deviceIds` whose endpoint devices are both visible under
 * the tenant scope, so no peer name from another tenant leaks into traces.
 */
function cablesOf(
	deviceIds: number[],
	scopeTenantIds: readonly number[] | undefined,
): Promise<LoadedCable[]> {
	return getDb()
		.select({
			cable: {
				id: cables.id,
				label: cables.label,
				status: cables.status,
				a_interface_id: cables.a_interface_id,
				b_interface_id: cables.b_interface_id,
			},
			a: ifaceColumns(aEnd),
			b: ifaceColumns(bEnd),
			aDevice: { id: aEndDevice.id, name: aEndDevice.name },
			bDevice: { id: bEndDevice.id, name: bEndDevice.name },
		})
		.from(cables)
		.innerJoin(aEnd, eq(aEnd.id, cables.a_interface_id))
		.innerJoin(aEndDevice, eq(aEndDevice.id, aEnd.device_id))
		.innerJoin(bEnd, eq(bEnd.id, cables.b_interface_id))
		.innerJoin(bEndDevice, eq(bEndDevice.id, bEnd.device_id))
		.where(
			and(
				or(inArray(aEnd.device_id, deviceIds), inArray(bEnd.device_id, deviceIds)),
				scopeCondition(aEndDevice.tenant_id, scopeTenantIds),
				scopeCondition(bEndDevice.tenant_id, scopeTenantIds),
			),
		)
}

const mapped = alias(interfaces, 'mapped')

/**
 * Visible patch-panel ports of the `deviceIds`, plus the panel ports their
 * front/rear mappings point at (on the same device, see `checkRearMapping`;
 * loaded by mapping as well, so a pass-through never misses its exit).
 */
function panelPortsOf(
	deviceIds: number[],
	scopeTenantIds: readonly number[] | undefined,
): Promise<InterfaceRow[]> {
	return getDb()
		.select(ifaceColumns(interfaces))
		.from(interfaces)
		.innerJoin(devices, eq(devices.id, interfaces.device_id))
		.where(
			and(
				isNotNull(interfaces.side),
				scopeCondition(devices.tenant_id, scopeTenantIds),
				or(
					inArray(interfaces.device_id, deviceIds),
					inArray(
						interfaces.rear_port_id,
						subquery
							.select({ id: mapped.id })
							.from(mapped)
							.where(inArray(mapped.device_id, deviceIds)),
					),
					inArray(
						interfaces.id,
						subquery
							.select({ id: mapped.rear_port_id })
							.from(mapped)
							.where(
								and(
									inArray(mapped.device_id, deviceIds),
									isNotNull(mapped.rear_port_id),
								),
							),
					),
				),
			),
		)
}

/** Where a trace starts and how far its walks can reach. */
interface GraphSeed {
	/** Devices the walks start from. */
	deviceIds: number[]
	/** Cable hops of the multi-hop walks (`walkPaths`). */
	depth: number
	/** Whether end-to-end peers (`endToEndOf`) are resolved from the seed devices. */
	endToEnd: boolean
	/** Port an interface trace begins at (loaded even when uncabled). */
	startIfaceId?: number
}

/**
 * Loads the part of the L1 graph a trace can reach, in rounds that each
 * load the cables and patch-panel ports of the devices found so far that
 * the walks may leave from:
 * - devices fewer than `depth` cable hops from a seed (the walks fan out
 *   over all their cables; panel pass-throughs only follow some of them,
 *   so counting every cable as one hop never loads less than they reach);
 * - for end-to-end peers, every device a seed reaches over at most
 *   `MAX_PANEL_PASSES` cables that each end on a patch-panel port.
 * A front port and the rear port it maps to count as one device. The walks
 * then run on this subgraph as on the whole one: every device they leave
 * from carries all its visible cables (in id order) and panel ports.
 * Scoped editors/viewers see only cables with both endpoint devices in
 * their tenant, so no peer name from another tenant leaks into traces.
 */
async function loadGraph(
	seed: GraphSeed,
	scopeTenantIds: readonly number[] | undefined,
): Promise<Graph> {
	const db = getDb()
	const seedRows = Promise.all([
		db
			.select({ id: devices.id, name: devices.name })
			.from(devices)
			.where(
				and(
					inArray(devices.id, seed.deviceIds),
					scopeCondition(devices.tenant_id, scopeTenantIds),
				),
			),
		seed.startIfaceId === undefined
			? Promise.resolve<InterfaceRow[]>([])
			: db
					.select(ifaceColumns(interfaces))
					.from(interfaces)
					.innerJoin(devices, eq(devices.id, interfaces.device_id))
					.where(
						and(
							eq(interfaces.id, seed.startIfaceId),
							scopeCondition(devices.tenant_id, scopeTenantIds),
						),
					),
	])
	/** Fewest cable hops from a seed, per device. */
	const cableHops = new Map<number, number>(seed.deviceIds.map((id) => [id, 0]))
	/** Fewest panel-port cables from a seed, per device (end-to-end reach). */
	const panelHops = new Map<number, number>(
		seed.endToEnd ? seed.deviceIds.map((id) => [id, 0]) : [],
	)
	const expanded = new Set<number>()
	const loaded = new Map<number, LoadedCable>()
	const ports = new Map<number, InterfaceRow>()
	const lower = (map: Map<number, number>, id: number, value: number): boolean => {
		if (value < (map.get(id) ?? Number.POSITIVE_INFINITY)) {
			map.set(id, value)
			return true
		}
		return false
	}
	const needed = (id: number): boolean =>
		(cableHops.get(id) ?? Number.POSITIVE_INFINITY) < seed.depth ||
		(panelHops.get(id) ?? Number.POSITIVE_INFINITY) <= MAX_PANEL_PASSES
	for (;;) {
		const frontier = [...new Set([...cableHops.keys(), ...panelHops.keys()])].filter(
			(id) => needed(id) && !expanded.has(id),
		)
		if (frontier.length === 0) {
			break
		}
		for (const id of frontier) {
			expanded.add(id)
		}
		const [cableRows, portRows] = await Promise.all([
			cablesOf(frontier, scopeTenantIds),
			panelPortsOf(frontier, scopeTenantIds),
		])
		for (const row of cableRows) {
			loaded.set(row.cable.id, row)
		}
		for (const port of portRows) {
			ports.set(port.id, port)
		}
		// Shortest reach over the loaded cables (one hop each) and mappings
		// (none), until nothing changes.
		let changed = true
		while (changed) {
			changed = false
			for (const port of ports.values()) {
				const rear = port.rear_port_id === null ? undefined : ports.get(port.rear_port_id)
				if (!rear || rear.device_id === port.device_id) {
					continue
				}
				for (const [from, to] of [
					[port.device_id, rear.device_id],
					[rear.device_id, port.device_id],
				] as const) {
					for (const map of [cableHops, panelHops]) {
						const value = map.get(from)
						if (value !== undefined && lower(map, to, value)) {
							changed = true
						}
					}
				}
			}
			for (const { a, b } of loaded.values()) {
				for (const [near, far] of [
					[a, b],
					[b, a],
				] as const) {
					const hop = cableHops.get(near.device_id)
					if (hop !== undefined && lower(cableHops, far.device_id, hop + 1)) {
						changed = true
					}
					const pass = panelHops.get(near.device_id)
					if (
						pass !== undefined &&
						far.side !== null &&
						lower(panelHops, far.device_id, pass + 1)
					) {
						changed = true
					}
				}
			}
		}
	}
	const [seedDevices, startIface] = await seedRows
	const deviceById = new Map(seedDevices.map((d) => [d.id, d]))
	const ifaceById = new Map<number, InterfaceRow>(startIface.map((i) => [i.id, i]))
	for (const port of ports.values()) {
		ifaceById.set(port.id, port)
	}
	// Walks expand cables in id order, so traces are stable.
	const cableRows = [...loaded.values()].sort((x, y) => x.cable.id - y.cable.id)
	for (const row of cableRows) {
		deviceById.set(row.aDevice.id, row.aDevice)
		deviceById.set(row.bDevice.id, row.bDevice)
		ifaceById.set(row.a.id, row.a)
		ifaceById.set(row.b.id, row.b)
	}
	const frontBySlot = new Map<string, InterfaceRow>()
	for (const i of ifaceById.values()) {
		if (i.side === 'front' && i.rear_port_id !== null) {
			frontBySlot.set(`${i.rear_port_id}:${i.rear_port_position ?? 1}`, i)
		}
	}
	const cableOf = new Map<number, AdjEntry>()
	const cableById = new Map<number, CableRow>()
	const adj: Map<number, AdjEntry[]> = new Map()
	const push = (deviceId: number, entry: AdjEntry): void => {
		const list = adj.get(deviceId)
		if (list) {
			list.push(entry)
		} else {
			adj.set(deviceId, [entry])
		}
	}
	for (const { cable, a, b } of cableRows) {
		cableById.set(cable.id, cable)
		const fromA = { cable, localIface: a, peerIface: b, peerDeviceId: b.device_id }
		const fromB = { cable, localIface: b, peerIface: a, peerDeviceId: a.device_id }
		push(a.device_id, fromA)
		push(b.device_id, fromB)
		cableOf.set(a.id, fromA)
		cableOf.set(b.id, fromB)
	}
	return { deviceById, ifaceById, cableById, adj, cableOf, frontBySlot }
}

/** Where a signal arriving on a patch-panel port leaves the panel. */
interface PassThrough {
	/** Port on the same panel the signal continues from. */
	exit: InterfaceRow
	/** Position stack after the pass-through. */
	stack: number[]
	/** Fanned out from a multi-position rear port without a known position. */
	split: boolean
}

/**
 * NetBox-style position tracking through a patch panel:
 * - arriving on a front port pushes its position and continues through its
 *   rear port;
 * - arriving on a rear port pops the position and continues through the
 *   front port mapped to that slot;
 * - arriving on a rear port with an empty stack continues through its one
 *   front port (1 position), or splits into every mapped front port.
 * Normal ports (no side) answer `null`: the walk fans out over the device.
 */
function passThrough(graph: Graph, arrival: InterfaceRow, stack: number[]): PassThrough[] | null {
	if (arrival.side === 'front') {
		const rear =
			arrival.rear_port_id === null ? undefined : graph.ifaceById.get(arrival.rear_port_id)
		return rear
			? [{ exit: rear, stack: [...stack, arrival.rear_port_position ?? 1], split: false }]
			: []
	}
	if (arrival.side !== 'rear') {
		return null
	}
	if (stack.length > 0) {
		const position = stack.at(-1) ?? 1
		const front = graph.frontBySlot.get(`${arrival.id}:${position}`)
		return front ? [{ exit: front, stack: stack.slice(0, -1), split: false }] : []
	}
	const out: PassThrough[] = []
	for (let position = 1; position <= arrival.positions; position += 1) {
		const front = graph.frontBySlot.get(`${arrival.id}:${position}`)
		if (front) {
			out.push({ exit: front, stack: [], split: arrival.positions > 1 })
		}
	}
	return out
}

function hopOf(graph: Graph, fromDeviceId: number, entry: AdjEntry): TraceHop | null {
	const fromDevice = graph.deviceById.get(fromDeviceId)
	const toDevice = graph.deviceById.get(entry.peerDeviceId)
	if (!fromDevice || !toDevice) {
		return null
	}
	return {
		cable_id: entry.cable.id,
		cable_label: entry.cable.label,
		cable_status: entry.cable.status,
		from_device: peerDeviceOf(fromDevice),
		from_interface: peerIfaceOf(entry.localIface),
		to_device: peerDeviceOf(toDevice),
		to_interface: peerIfaceOf(entry.peerIface),
	}
}

interface Walk {
	deviceId: number
	path: TraceHop[]
	/** Port the walk arrived on (`null` at the source device). */
	arrival: InterfaceRow | null
	/** Positions pushed by the front ports passed so far. */
	stack: number[]
	split: boolean
}

/**
 * Next cable hops of a walk: through a patch panel only via the port its
 * pass-through leads to (position stack), elsewhere over every other cable
 * of the device. The arrival cable is never taken back.
 */
function nextSteps(
	graph: Graph,
	current: Walk,
): { entry: AdjEntry; stack: number[]; split: boolean }[] {
	const passes = current.arrival ? passThrough(graph, current.arrival, current.stack) : null
	if (passes) {
		return passes.flatMap((pass) => {
			const entry = graph.cableOf.get(pass.exit.id)
			return entry ? [{ entry, stack: pass.stack, split: current.split || pass.split }] : []
		})
	}
	const arrivedOnCable = current.path.at(-1)?.cable_id
	return (graph.adj.get(current.deviceId) ?? [])
		.filter((entry) => entry.cable.id !== arrivedOnCable)
		.map((entry) => ({ entry, stack: current.stack, split: current.split }))
}

/**
 * Breadth-first expansion shared by the device and interface traces: one
 * path per newly reached device (first visit wins = shortest), up to
 * `depth` cable hops. Patch panels are passed port by port, so one panel
 * carries many paths; a port is never walked out of twice.
 */
function walkPaths(
	graph: Graph,
	queue: Walk[],
	visited: Set<number>,
	depth: number,
	paths: TracePath[],
): TracePath[] {
	const walkedPorts = new Set<string>()
	while (queue.length > 0 && paths.length < MAX_TRACE_PATHS) {
		const current = queue.shift()
		if (!current || current.path.length >= depth) {
			continue
		}
		for (const { entry, stack, split } of nextSteps(graph, current)) {
			const portKey = `${entry.localIface.id}:${stack.join('.')}`
			if (walkedPorts.has(portKey)) {
				continue
			}
			walkedPorts.add(portKey)
			const peerIsPanelPort = entry.peerIface.side !== null
			if (visited.has(entry.peerDeviceId) && !peerIsPanelPort) {
				continue
			}
			const hop = hopOf(graph, current.deviceId, entry)
			if (!hop) {
				continue
			}
			const next = [...current.path, hop]
			const end = graph.deviceById.get(entry.peerDeviceId)
			if (end && !visited.has(entry.peerDeviceId)) {
				paths.push({ hops: next, end_device: peerDeviceOf(end), split })
			}
			visited.add(entry.peerDeviceId)
			if (next.length < depth) {
				queue.push({
					deviceId: entry.peerDeviceId,
					path: next,
					arrival: entry.peerIface,
					stack,
					split,
				})
			}
			if (paths.length >= MAX_TRACE_PATHS) {
				break
			}
		}
	}
	return paths
}

/** BFS shortest paths from a source device (the source itself excluded). */
function bfsDevicePaths(graph: Graph, sourceDeviceId: number, depth: number): TracePath[] {
	return walkPaths(
		graph,
		[{ deviceId: sourceDeviceId, path: [], arrival: null, stack: [], split: false }],
		new Set([sourceDeviceId]),
		depth,
		[],
	)
}

/**
 * BFS shortest paths starting at one interface. The first hop is fixed to
 * that port's cable; onward expansion fans out from the peer device over
 * all of its other cabled ports, or passes through it when it is a patch
 * panel.
 */
function bfsInterfacePaths(graph: Graph, startIface: InterfaceRow, depth: number): TracePath[] {
	const first = graph.cableOf.get(startIface.id)
	const firstHop = first ? hopOf(graph, startIface.device_id, first) : null
	if (!first || !firstHop) {
		return []
	}
	const end = graph.deviceById.get(first.peerDeviceId)
	return walkPaths(
		graph,
		[
			{
				deviceId: first.peerDeviceId,
				path: [firstHop],
				arrival: first.peerIface,
				stack: [],
				split: false,
			},
		],
		new Set([startIface.device_id, first.peerDeviceId]),
		depth,
		end ? [{ hops: [firstHop], end_device: peerDeviceOf(end), split: false }] : [],
	)
}

/**
 * End-to-end peers of one cabled port: follows its cable and every patch
 * panel behind it (position stack) to the first port that is no panel
 * port, or to an uncabled panel port. Answers nothing when the direct peer
 * is no panel port (the link already names it); a split rear port gives
 * one entry per mapped front port.
 */
function endToEndOf(graph: Graph, start: InterfaceRow): TraceEndToEnd[] {
	const first = graph.cableOf.get(start.id)
	if (!first || first.peerIface.side === null) {
		return []
	}
	const out: TraceEndToEnd[] = []
	const walk = (
		entry: AdjEntry,
		via: TracePanelPass[],
		stack: number[],
		split: boolean,
	): void => {
		const arrival = entry.peerIface
		const device = graph.deviceById.get(entry.peerDeviceId)
		if (!device) {
			return
		}
		const passes = passThrough(graph, arrival, stack)
		if (passes === null || via.length >= MAX_PANEL_PASSES) {
			out.push({
				local_interface_id: start.id,
				end_device: peerDeviceOf(device),
				end_interface: peerIfaceOf(arrival),
				via,
				split,
			})
			return
		}
		const ends = passes.length === 0 ? [null] : passes
		for (const pass of ends) {
			const next = pass ? graph.cableOf.get(pass.exit.id) : undefined
			const passed: TracePanelPass = {
				device: peerDeviceOf(device),
				in_interface: peerIfaceOf(arrival),
				out_interface: pass ? peerIfaceOf(pass.exit) : null,
			}
			if (!pass || !next) {
				// Uncabled panel port: the circuit ends inside the panel.
				out.push({
					local_interface_id: start.id,
					end_device: null,
					end_interface: null,
					via: [...via, passed],
					split: split || (pass?.split ?? false),
				})
				continue
			}
			walk(next, [...via, passed], pass.stack, split || pass.split)
		}
	}
	walk(first, [], [], false)
	return out
}

/** 404 for a device the scoped graph does not hold: out of scope, or missing. */
async function deviceNotFound(deviceId: number): Promise<NotFoundError> {
	return new NotFoundError(
		(await exists(devices, eq(devices.id, deviceId)))
			? 'Device is outside your tenant scope'
			: 'Device not found',
	)
}

/**
 * Per-device trace: every local interface carrying a visible cable resolves
 * to its peer as `dev:port <-> dev:port`, plus the depth-limited multi-hop
 * shortest paths. Scoped callers only traverse cables with both ends in
 * their tenant; a device outside the scope answers with no links or paths.
 */
export async function getDeviceTrace(
	deviceId: number,
	depth: number,
	scopeTenantIds?: readonly number[],
): Promise<Result<DeviceTraceResponse, Error>> {
	const boundedDepth = Math.min(Math.max(Math.floor(depth), 1), 10)
	const graph = await loadGraph(
		{ deviceIds: [deviceId], depth: boundedDepth, endToEnd: true },
		scopeTenantIds,
	)
	if (!graph.deviceById.has(deviceId)) {
		if (!(await exists(devices, eq(devices.id, deviceId)))) {
			return Result.err(new NotFoundError('Device not found'))
		}
		return Result.ok({ device_id: deviceId, links: [], paths: [], end_to_end: [] })
	}
	const links: TraceLink[] = []
	for (const entry of graph.adj.get(deviceId) ?? []) {
		const peerDevice = graph.deviceById.get(entry.peerDeviceId)
		if (peerDevice) {
			links.push({
				cable_id: entry.cable.id,
				cable_label: entry.cable.label,
				cable_status: entry.cable.status,
				local_interface: peerIfaceOf(entry.localIface),
				peer_device: peerDeviceOf(peerDevice),
				peer_interface: peerIfaceOf(entry.peerIface),
			})
		}
	}
	links.sort((a, b) => a.local_interface.id - b.local_interface.id)
	return Result.ok({
		device_id: deviceId,
		links,
		paths: bfsDevicePaths(graph, deviceId, boundedDepth),
		end_to_end: links.flatMap((link) => {
			const local = graph.ifaceById.get(link.local_interface.id)
			return local ? endToEndOf(graph, local) : []
		}),
	})
}

export async function getInterfaceTrace(
	deviceId: number,
	ifaceId: number,
	depth: number,
	scopeTenantIds?: readonly number[],
): Promise<Result<InterfaceTraceResponse, Error>> {
	const graph = await loadGraph(
		{ deviceIds: [deviceId], depth, endToEnd: true, startIfaceId: ifaceId },
		scopeTenantIds,
	)
	const device = graph.deviceById.get(deviceId)
	if (!device) {
		return Result.err(await deviceNotFound(deviceId))
	}
	const iface = graph.ifaceById.get(ifaceId)
	if (!iface || iface.device_id !== deviceId) {
		return Result.err(new NotFoundError('Interface not found on this device'))
	}
	return Result.ok({
		start_device: peerDeviceOf(device),
		start_interface: peerIfaceOf(iface),
		paths: bfsInterfacePaths(graph, iface, depth),
		end_to_end: endToEndOf(graph, iface),
	})
}

export async function getCableTrace(
	cableId: number,
	depth: number,
	scopeTenantIds?: readonly number[],
): Promise<Result<CableTraceResponse, Error>> {
	const ends = await getDb()
		.select({ a: aEnd.device_id, b: bEnd.device_id })
		.from(cables)
		.innerJoin(aEnd, eq(aEnd.id, cables.a_interface_id))
		.innerJoin(bEnd, eq(bEnd.id, cables.b_interface_id))
		.where(eq(cables.id, cableId))
	const graph = await loadGraph(
		{ deviceIds: ends.flatMap((end) => [end.a, end.b]), depth, endToEnd: false },
		scopeTenantIds,
	)
	const cable = graph.cableById.get(cableId)
	if (!cable) {
		return Result.err(
			new NotFoundError(
				(await exists(cables, eq(cables.id, cableId)))
					? 'Cable endpoints are outside your tenant scope'
					: 'Cable not found',
			),
		)
	}
	const a = graph.ifaceById.get(cable.a_interface_id)
	const b = graph.ifaceById.get(cable.b_interface_id)
	const aDevice = a ? graph.deviceById.get(a.device_id) : undefined
	const bDevice = b ? graph.deviceById.get(b.device_id) : undefined
	if (!a || !b || !aDevice || !bDevice) {
		return Result.err(new NotFoundError('Cable not found'))
	}
	// Onward paths from each side: every path starts with the traced
	// cable itself, then fans out from the peer device.
	const pathsFromA = bfsInterfacePaths(graph, a, depth)
	const pathsFromB = bfsInterfacePaths(graph, b, depth)
	return Result.ok({
		cable_id: cable.id,
		cable_label: cable.label,
		cable_status: cable.status,
		a_device: peerDeviceOf(aDevice),
		a_interface: peerIfaceOf(a),
		b_device: peerDeviceOf(bDevice),
		b_interface: peerIfaceOf(b),
		paths_from_a: pathsFromA,
		paths_from_b: pathsFromB,
	})
}
