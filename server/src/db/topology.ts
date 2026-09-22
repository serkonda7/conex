import { Result } from 'better-result'
import { eq } from 'drizzle-orm'
import type {
	CableTraceResponse,
	InterfaceTraceResponse,
	TopologyEdge,
	TopologyNode,
	TopologyResponse,
	TraceHop,
	TracePath,
	TracePeerDevice,
	TracePeerInterface,
} from 'shared/src/schemas'
import { cables, devices, interfaces } from '../schema'
import { getDb } from './connection'
import { NotFoundError } from './errors'

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

function toNode(row: DeviceRow): TopologyNode {
	return {
		id: row.id,
		name: row.name,
		status: row.status,
		site_id: row.site_id,
		rack_id: row.rack_id,
		tenant_id: row.tenant_id,
	}
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
function loadGraph(scopeTenantId?: number): Graph {
	const db = getDb()
	const deviceById = new Map<number, DeviceRow>()
	for (const d of db.select().from(devices).all()) {
		if (scopeTenantId !== undefined && d.tenant_id !== scopeTenantId) {
			continue
		}
		deviceById.set(d.id, d)
	}
	const ifaceById = new Map<number, InterfaceRow>()
	for (const i of db.select().from(interfaces).all()) {
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
	for (const cable of db.select().from(cables).all()) {
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

/**
 * BFS shortest paths from a source device, up to `depth` cable hops.
 * One path per reachable device (first visit wins = shortest), excluding
 * the source itself. Arrival interface is excluded from onward expansion
 * so paths never bounce straight back down the cable they arrived on.
 */
export function bfsDevicePaths(graph: Graph, sourceDeviceId: number, depth: number): TracePath[] {
	const paths: TracePath[] = []
	const visited = new Set<number>([sourceDeviceId])
	const queue: Array<{ deviceId: number; path: TraceHop[] }> = [
		{ deviceId: sourceDeviceId, path: [] },
	]
	while (queue.length > 0 && paths.length < MAX_TRACE_PATHS) {
		const current = queue.shift()
		if (!current || current.path.length >= depth) {
			continue
		}
		const entries = graph.adj.get(current.deviceId) ?? []
		const arrivedOnCable =
			current.path.length > 0 ? current.path[current.path.length - 1]?.cable_id : undefined
		for (const entry of entries) {
			if (entry.cable.id === arrivedOnCable) {
				continue
			}
			if (visited.has(entry.peerDeviceId)) {
				continue
			}
			const hop = hopOf(graph, current.deviceId, entry)
			if (!hop) {
				continue
			}
			const next: TraceHop[] = [...current.path, hop]
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

/**
 * BFS shortest paths starting at one interface. The first hop is fixed to
 * that port's cable; onward expansion fans out from the peer device over
 * all of its other cabled ports.
 */
export function bfsInterfacePaths(
	graph: Graph,
	startIface: InterfaceRow,
	depth: number,
): TracePath[] {
	const first = (graph.adj.get(startIface.device_id) ?? []).find(
		(e) => e.localIface.id === startIface.id,
	)
	if (!first) {
		return []
	}
	const firstHop = hopOf(graph, startIface.device_id, first)
	if (!firstHop) {
		return []
	}
	const end = graph.deviceById.get(first.peerDeviceId)
	const paths: TracePath[] = end ? [{ hops: [firstHop], end_device: peerDeviceOf(end) }] : []
	if (depth <= 1) {
		return paths
	}
	const visited = new Set<number>([startIface.device_id, first.peerDeviceId])
	const queue: Array<{ deviceId: number; path: TraceHop[] }> = [
		{ deviceId: first.peerDeviceId, path: [firstHop] },
	]
	while (queue.length > 0 && paths.length < MAX_TRACE_PATHS) {
		const current = queue.shift()
		if (!current || current.path.length >= depth) {
			continue
		}
		const arrivedOnCable = current.path[current.path.length - 1]?.cable_id
		for (const entry of graph.adj.get(current.deviceId) ?? []) {
			if (entry.cable.id === arrivedOnCable) {
				continue
			}
			if (visited.has(entry.peerDeviceId)) {
				continue
			}
			const hop = hopOf(graph, current.deviceId, entry)
			if (!hop) {
				continue
			}
			const next = [...current.path, hop]
			visited.add(entry.peerDeviceId)
			const target = graph.deviceById.get(entry.peerDeviceId)
			if (target) {
				paths.push({ hops: next, end_device: peerDeviceOf(target) })
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

export interface TopologyParams {
	site?: number
	device?: number
	scopeTenantId?: number
}

/**
 * Device-graph snapshot for the topology view: every visible device is a
 * node, every visible cable an edge. `site` keeps only that site's nodes
 * (edges need both ends inside); `device` keeps the connected component
 * containing that device (after the site filter).
 */
export function getTopology(params: TopologyParams): TopologyResponse {
	const graph = loadGraph(params.scopeTenantId)
	let nodeIds = new Set(graph.deviceById.keys())
	if (params.site !== undefined) {
		nodeIds = new Set(
			[...graph.deviceById.values()]
				.filter((d) => d.site_id === params.site)
				.map((d) => d.id),
		)
	}
	if (params.device !== undefined) {
		if (!nodeIds.has(params.device)) {
			return { nodes: [], edges: [] }
		}
		const seen = new Set<number>([params.device])
		const queue = [params.device]
		while (queue.length > 0) {
			const current = queue.shift()
			if (current === undefined) {
				continue
			}
			for (const entry of graph.adj.get(current) ?? []) {
				if (!nodeIds.has(entry.peerDeviceId) || seen.has(entry.peerDeviceId)) {
					continue
				}
				seen.add(entry.peerDeviceId)
				queue.push(entry.peerDeviceId)
			}
		}
		nodeIds = seen
	}
	const nodes: TopologyNode[] = [...nodeIds]
		.map((id) => graph.deviceById.get(id))
		.filter((d): d is DeviceRow => d !== undefined)
		.sort((a, b) => a.name.localeCompare(b.name))
		.map(toNode)
	const edges: TopologyEdge[] = []
	const seenCables = new Set<number>()
	for (const deviceId of nodeIds) {
		for (const entry of graph.adj.get(deviceId) ?? []) {
			if (seenCables.has(entry.cable.id) || !nodeIds.has(entry.peerDeviceId)) {
				continue
			}
			const aDevice = graph.deviceById.get(entry.localIface.device_id)
			const bDevice = graph.deviceById.get(entry.peerIface.device_id)
			if (!aDevice || !bDevice) {
				continue
			}
			seenCables.add(entry.cable.id)
			edges.push({
				cable_id: entry.cable.id,
				cable_label: entry.cable.label,
				cable_status: entry.cable.status,
				cable_kind: entry.cable.kind,
				a: {
					device: peerDeviceOf(aDevice),
					iface: peerIfaceOf(entry.localIface),
				},
				b: {
					device: peerDeviceOf(bDevice),
					iface: peerIfaceOf(entry.peerIface),
				},
			})
		}
	}
	edges.sort((a, b) => a.cable_id - b.cable_id)
	return { nodes, edges }
}

export function getDevicePaths(
	deviceId: number,
	depth: number,
	scopeTenantId?: number,
): Result<TracePath[], Error> {
	const graph = loadGraph(scopeTenantId)
	if (!graph.deviceById.has(deviceId)) {
		const exists = getDb().select().from(devices).where(eq(devices.id, deviceId)).get()
		return Result.err(
			new NotFoundError(exists ? 'Device is outside your tenant scope' : 'Device not found'),
		)
	}
	return Result.ok(bfsDevicePaths(graph, deviceId, depth))
}

export function getInterfaceTrace(
	deviceId: number,
	ifaceId: number,
	depth: number,
	scopeTenantId?: number,
): Result<InterfaceTraceResponse, Error> {
	const graph = loadGraph(scopeTenantId)
	const device = graph.deviceById.get(deviceId)
	if (!device) {
		const exists = getDb().select().from(devices).where(eq(devices.id, deviceId)).get()
		return Result.err(
			new NotFoundError(exists ? 'Device is outside your tenant scope' : 'Device not found'),
		)
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

export function getCableTrace(
	cableId: number,
	depth: number,
	scopeTenantId?: number,
): Result<CableTraceResponse, Error> {
	const graph = loadGraph(scopeTenantId)
	const cable = graph.cableById.get(cableId)
	if (!cable) {
		const exists = getDb().select().from(cables).where(eq(cables.id, cableId)).get()
		return Result.err(
			new NotFoundError(
				exists ? 'Cable endpoints are outside your tenant scope' : 'Cable not found',
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
