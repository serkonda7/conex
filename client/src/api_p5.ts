/**
 * P5 API wrappers: typed cables/trace calls over the hono RPC client.
 * Errors surface as `Result.err` with the server's `{ error }` message,
 * matching the device wrappers in `api_p4.ts`.
 */
import type { Result } from 'better-result'
import type { CableRow } from 'server/src/db/cables'
import type { DeviceTraceResponse } from 'shared/src/schemas'
import { client, to_result } from './api'
import type { Page } from './api_p4'
import type { ApiResponse } from './util/api_error'

export type { CableRow, DeviceTraceResponse }

export interface CableFilters {
	search?: string
	status?: 'connected' | 'planned' | 'decommissioned'
	device?: string
	iface?: string
}

export async function fetch_cables(filters?: CableFilters): Promise<Result<Page<CableRow>, Error>> {
	const res = await client.cables.$get({
		query: {
			search: filters?.search ?? '',
			page: '1',
			limit: '200',
			status: filters?.status,
			interface: filters?.iface,
			device: filters?.device,
		},
	})
	return to_result<Page<CableRow>>(res, 'Failed to load cables')
}

export async function create_cable(input: {
	a_interface_id: string
	b_interface_id: string
	label?: string
	kind?: string
	status?: 'connected' | 'planned' | 'decommissioned'
}): Promise<Result<CableRow, Error>> {
	const res = await client.cables.$post({ json: input })
	return to_result<CableRow>(res, 'Failed to create cable')
}

export async function delete_cable(id: string): Promise<Result<unknown, Error>> {
	const res = await client.cables[':id'].$delete({ param: { id } })
	return to_result<unknown>(res, 'Failed to delete cable')
}

export async function connect_interface(
	deviceId: string,
	ifaceId: string,
	peerInterfaceId: string,
): Promise<Result<CableRow, Error>> {
	const res = await client.devices[':id'].interfaces[':ifaceId'].connect.$post({
		param: { id: deviceId, ifaceId },
		json: { peer_interface_id: peerInterfaceId },
	})
	return to_result<CableRow>(res, 'Failed to connect interface')
}

export async function fetch_trace(deviceId: string): Promise<Result<DeviceTraceResponse, Error>> {
	const res: ApiResponse = await client.devices[':id'].trace.$get({
		param: { id: deviceId },
	})
	return to_result<DeviceTraceResponse>(res, 'Failed to load trace')
}
