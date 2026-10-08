import { Result } from 'better-result'
import { eq } from 'drizzle-orm'
import type {
	CableTraceResponse,
	DeviceTraceResponse,
	InterfaceTraceResponse,
	TraceHop,
	TraceLink,
	TracePath,
	TracePeerDevice,
	TracePeerInterface,
} from 'shared/src/schemas'
import { cables, devices, interfaces } from '../schema'
import { getDb } from './connection'
import { NotFoundError } from './errors'
import { exists } from './list'

type DeviceRow = typeof devices.$inferSelect
type InterfaceRow = typeof interfaces.$inferSelect
type CableRow = typeof cables.$inferSelect

interface AdjEntry {
	cable: CableRow
	localIface: InterfaceRow
	peerIface: InterfaceRow
	peerDeviceId: number
}

const MAX_TRACE_PATHS = 200

function peerDeviceOf(row: DeviceRow): TracePeerDevice {
	return { id: row.id, name: row.name }
}

function peerIfaceOf(row: InterfaceRow): TracePeerInterface {
	return { id: row.id, name: row.name, kind: row.kind }
}

interface Graph {
	deviceById: Map<number, DeviceRow>
	ifaceById: Map<number, InterfaceRow>
	cableById: Map<number, CableRow>
	adj: Map<number, AdjEntry[]>
}

/**
 * Loads the L1 graph into memory (inventories are small) and drops every
 * cable whose endpoints are not both visible under the tenant scope.
 * Scoped editors/viewers see only cables with both endpoint devices in
 * their tenant, so no peer name from another tenant leaks into traces.
 */
async function loadGraph(scopeTenantId?: number): Promise<Graph> {
	const db = getDb()
	const deviceById = new Map<number, DeviceRow>()
	for (const d of await db.select().from(devices)) {
		if (scopeTenantId !== undefined && d.tenant_id !== scopeTenantId) {
			continue
		}
		deviceById.set(d.id, d)
	}
	const ifaceById = new Map<number, InterfaceRow>()
	for (const i of await db.select().from(interfaces)) {
		if (!deviceById.has(i.device_id)) {
			continue
		}
		ifaceById.set(i.id, i)
	}
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
	for (const cable of await db.select().from(cables)) {
		const a = ifaceById.get(cable.a_interface_id)
		const b = ifaceById.get(cable.b_interface_id)
		if (!a || !b) {
			continue
		}
		if (!deviceById.has(a.device_id) || !deviceById.has(b.device_id)) {
			continue
		}
		cableById.set(cable.id, cable)
		push(a.device_id, { cable, localIface: a, peerIface: b, peerDeviceId: b.device_id })
		push(b.device_id, { cable, localIface: b, peerIface: a, peerDeviceId: a.device_id })
	}
	return { deviceById, ifaceById, cableById, adj }
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
}

/**
 * Breadth-first expansion shared by the device and interface traces: one
 * path per newly reached device (first visit wins = shortest), up to
 * `depth` cable hops. The arrival cable is excluded from onward expansion
 * so paths never bounce straight back down the cable they arrived on.
 */
function walkPaths(
	graph: Graph,
	queue: Walk[],
	visited: Set<number>,
	depth: number,
	paths: TracePath[],
): TracePath[] {
	while (queue.length > 0 && paths.length < MAX_TRACE_PATHS) {
		const current = queue.shift()
		if (!current || current.path.length >= depth) {
			continue
		}
		const arrivedOnCable = current.path.at(-1)?.cable_id
		for (const entry of graph.adj.get(current.deviceId) ?? []) {
			if (entry.cable.id === arrivedOnCable || visited.has(entry.peerDeviceId)) {
				continue
			}
			const hop = hopOf(graph, current.deviceId, entry)
			if (!hop) {
				continue
			}
			const next = [...current.path, hop]
			visited.add(entry.peerDeviceId)
			const end = graph.deviceById.get(entry.peerDeviceId)
			if (end) {
				paths.push({ hops: next, end_device: peerDeviceOf(end) })
			}
			if (next.length < depth) {
				queue.push({ deviceId: entry.peerDeviceId, path: next })
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
		[{ deviceId: sourceDeviceId, path: [] }],
		new Set([sourceDeviceId]),
		depth,
		[],
	)
}

/**
 * BFS shortest paths starting at one interface. The first hop is fixed to
 * that port's cable; onward expansion fans out from the peer device over
 * all of its other cabled ports.
 */
function bfsInterfacePaths(graph: Graph, startIface: InterfaceRow, depth: number): TracePath[] {
	const first = (graph.adj.get(startIface.device_id) ?? []).find(
		(e) => e.localIface.id === startIface.id,
	)
	const firstHop = first ? hopOf(graph, startIface.device_id, first) : null
	if (!first || !firstHop) {
		return []
	}
	const end = graph.deviceById.get(first.peerDeviceId)
	return walkPaths(
		graph,
		[{ deviceId: first.peerDeviceId, path: [firstHop] }],
		new Set([startIface.device_id, first.peerDeviceId]),
		depth,
		end ? [{ hops: [firstHop], end_device: peerDeviceOf(end) }] : [],
	)
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
	scopeTenantId?: number,
): Promise<Result<DeviceTraceResponse, Error>> {
	const graph = await loadGraph(scopeTenantId)
	if (!graph.deviceById.has(deviceId)) {
		if (!(await exists(devices, eq(devices.id, deviceId)))) {
			return Result.err(new NotFoundError('Device not found'))
		}
		return Result.ok({ device_id: deviceId, links: [], paths: [] })
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
	const boundedDepth = Math.min(Math.max(Math.floor(depth), 1), 10)
	return Result.ok({
		device_id: deviceId,
		links,
		paths: bfsDevicePaths(graph, deviceId, boundedDepth),
	})
}

export async function getInterfaceTrace(
	deviceId: number,
	ifaceId: number,
	depth: number,
	scopeTenantId?: number,
): Promise<Result<InterfaceTraceResponse, Error>> {
	const graph = await loadGraph(scopeTenantId)
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
	})
}

export async function getCableTrace(
	cableId: number,
	depth: number,
	scopeTenantId?: number,
): Promise<Result<CableTraceResponse, Error>> {
	const graph = await loadGraph(scopeTenantId)
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
