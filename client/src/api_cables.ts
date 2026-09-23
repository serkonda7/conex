/**
 * Cables API wrappers: typed cables/trace calls over the hono RPC client.
 * Errors surface as `Result.err` with the server's `{ error }` message,
 * matching the device wrappers in `api_devices.ts`.
 */
import type { Result } from 'better-result'
import type { CableRow } from 'server/src/db/cables'
import type { DeviceTraceResponse, Page } from 'shared/src/types'
import { client, getPage, to_query, to_result } from './api'

export type { CableRow, DeviceTraceResponse }

export interface CableFilters {
	search?: string
	status?: 'connected' | 'planned' | 'decommissioned'
	device?: number
	iface?: number
}

export async function fetch_cables(filters?: CableFilters): Promise<Result<Page<CableRow>, Error>> {
	return getPage<CableRow>(
		client.cables.$get({
			query: to_query({
				search: filters?.search ?? '',
				page: 1,
				limit: 200,
				status: filters?.status,
				interface: filters?.iface,
				device: filters?.device,
			}),
		}),
		'Failed to load cables',
	)
}

export async function create_cable(input: {
	a_interface_id: number
	b_interface_id: number
	label?: string
	kind?: string
	status?: 'connected' | 'planned' | 'decommissioned'
}): Promise<Result<CableRow, Error>> {
	const res = await client.cables.$post({ json: input })
	return to_result<CableRow>(res, 'Failed to create cable')
}

export async function delete_cable(id: number): Promise<Result<unknown, Error>> {
	const res = await client.cables[':id'].$delete({ param: { id: String(id) } })
	return to_result<unknown>(res, 'Failed to delete cable')
}

export async function connect_interface(
	deviceId: number,
	ifaceId: number,
	peerInterfaceId: number,
): Promise<Result<CableRow, Error>> {
	const res = await client.devices[':id'].interfaces[':ifaceId'].connect.$post({
		param: { id: String(deviceId), ifaceId: String(ifaceId) },
		json: { peer_interface_id: peerInterfaceId },
	})
	return to_result<CableRow>(res, 'Failed to connect interface')
}

export async function fetch_trace(
	deviceId: number,
	depth?: number,
): Promise<Result<DeviceTraceResponse, Error>> {
	const res = await client.devices[':id'].trace.$get({
		param: { id: String(deviceId) },
		query: to_query({ depth }),
	})
	return to_result<DeviceTraceResponse>(res, 'Failed to load trace')
}
