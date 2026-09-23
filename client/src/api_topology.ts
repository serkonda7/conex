/**
 * Topology + cable-trace API wrappers: typed graph/trace calls over the
 * hono RPC client. Errors surface as `Result.err` with the server's
 * `{ error }` message, matching the cable wrappers in `api_cables.ts`.
 */
import type { Result } from 'better-result'
import type {
	CableTraceResponse,
	InterfaceTraceResponse,
	TopologyQuery,
	TopologyResponse,
} from 'shared/src/types'
import { client, to_query, to_result } from './api'

export type { CableTraceResponse, InterfaceTraceResponse, TopologyResponse }

export type TopologyFilters = Partial<TopologyQuery>

export async function fetch_topology(
	filters?: TopologyFilters,
): Promise<Result<TopologyResponse, Error>> {
	const res = await client.topology.$get({
		query: to_query({
			group: filters?.group,
			site: filters?.site,
			device: filters?.device,
		}),
	})
	return to_result<TopologyResponse>(res, 'Failed to load topology')
}

export async function fetch_interface_trace(
	deviceId: number,
	ifaceId: number,
	depth?: number,
): Promise<Result<InterfaceTraceResponse, Error>> {
	const res = await client.devices[':id'].interfaces[':ifaceId'].trace.$get({
		param: { id: String(deviceId), ifaceId: String(ifaceId) },
		query: to_query({ depth }),
	})
	return to_result<InterfaceTraceResponse>(res, 'Failed to load interface trace')
}

export async function fetch_cable_trace(
	cableId: number,
	depth?: number,
): Promise<Result<CableTraceResponse, Error>> {
	const res = await client.cables[':id'].trace.$get({
		param: { id: String(cableId) },
		query: to_query({ depth }),
	})
	return to_result<CableTraceResponse>(res, 'Failed to load cable trace')
}
