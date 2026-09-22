/**
 * Topology + cable-trace API wrappers: typed graph/trace calls over the
 * hono RPC client. Errors surface as `Result.err` with the server's
 * `{ error }` message, matching the cable wrappers in `api_p5.ts`.
 */
import type { Result } from 'better-result'
import type {
	CableTraceResponse,
	InterfaceTraceResponse,
	TopologyResponse,
} from 'shared/src/schemas'
import { client, to_result } from './api'
import type { ApiResponse } from './util/api_error'

export type { CableTraceResponse, InterfaceTraceResponse, TopologyResponse }

export interface TopologyFilters {
	group?: number
	site?: number
	device?: number
}

export async function fetch_topology(
	filters?: TopologyFilters,
): Promise<Result<TopologyResponse, Error>> {
	const res: ApiResponse = await client.topology.$get({
		query: {
			group: filters?.group === undefined ? undefined : String(filters.group),
			site: filters?.site === undefined ? undefined : String(filters.site),
			device: filters?.device === undefined ? undefined : String(filters.device),
		},
	})
	return to_result<TopologyResponse>(res, 'Failed to load topology')
}

export async function fetch_interface_trace(
	deviceId: number,
	ifaceId: number,
	depth?: number,
): Promise<Result<InterfaceTraceResponse, Error>> {
	const res: ApiResponse = await client.devices[':id'].interfaces[':ifaceId'].trace.$get({
		param: { id: String(deviceId), ifaceId: String(ifaceId) },
		query: { depth: depth === undefined ? undefined : String(depth) },
	})
	return to_result<InterfaceTraceResponse>(res, 'Failed to load interface trace')
}

export async function fetch_cable_trace(
	cableId: number,
	depth?: number,
): Promise<Result<CableTraceResponse, Error>> {
	const res: ApiResponse = await client.cables[':id'].trace.$get({
		param: { id: String(cableId) },
		query: { depth: depth === undefined ? undefined : String(depth) },
	})
	return to_result<CableTraceResponse>(res, 'Failed to load cable trace')
}
