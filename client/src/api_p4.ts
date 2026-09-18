/**
 * P4 API wrappers: typed devices/interfaces calls over the hono RPC client.
 * Errors surface as `Result.err` with the server's `{ error }` message,
 * matching the auth wrappers in `api_auth.ts`.
 */
import type { Result } from 'better-result'
import type { DeviceRow, InterfaceJson } from 'server/src/db/devices'
import { client, to_result } from './api'
import type { ApiResponse } from './util/api_error'

export interface Page<T> {
	items: T[]
	total: number
	page: number
	limit: number
}

export type { DeviceRow, InterfaceJson }

async function getPage<T>(
	req: Promise<ApiResponse>,
	fallback: string,
): Promise<Result<Page<T>, Error>> {
	return to_result<Page<T>>(await req, fallback)
}

export interface DeviceFilters {
	search?: string
	site?: string
	rack?: string
	tenant?: string
	status?: 'active' | 'planned' | 'staged' | 'decommissioned'
}

export async function fetch_devices(
	filters?: DeviceFilters,
): Promise<Result<Page<DeviceRow>, Error>> {
	return getPage<DeviceRow>(
		client.devices.$get({
			query: {
				search: filters?.search ?? '',
				page: '1',
				limit: '200',
				site: filters?.site,
				rack: filters?.rack,
				tenant: filters?.tenant,
				status: filters?.status,
			},
		}),
		'Failed to load devices',
	)
}

export async function fetch_device(id: string): Promise<Result<DeviceRow, Error>> {
	const res = await client.devices[':id'].$get({ param: { id } })
	return to_result<DeviceRow>(res, 'Failed to load device')
}

export async function create_device(input: {
	device_type_id: string
	name: string
	site_id?: string | null
	rack_id?: string | null
	position_u?: number | null
	shelf_id?: string | null
	asset_tag?: string | null
	status?: 'active' | 'planned' | 'staged' | 'decommissioned'
}): Promise<Result<DeviceRow, Error>> {
	const res = await client.devices.$post({ json: input })
	return to_result<DeviceRow>(res, 'Failed to create device')
}

export async function move_device(
	id: string,
	input: { rack_id?: string | null; position_u?: number | null; shelf_id?: string | null },
): Promise<Result<DeviceRow, Error>> {
	const res = await client.devices[':id'].move.$post({ param: { id }, json: input })
	return to_result<DeviceRow>(res, 'Failed to move device')
}

export async function delete_device(id: string): Promise<Result<unknown, Error>> {
	const res = await client.devices[':id'].$delete({ param: { id } })
	return to_result<unknown>(res, 'Failed to delete device')
}

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export async function fetch_interfaces(deviceId: string): Promise<Result<InterfaceJson[], Error>> {
	const res = await client.devices[':id'].interfaces.$get({ param: { id: deviceId } })
	return to_result<InterfaceJson[]>(res, 'Failed to load interfaces')
}

export async function add_interface(
	deviceId: string,
	input: { name: string; kind?: string },
): Promise<Result<InterfaceJson, Error>> {
	const res = await client.devices[':id'].interfaces.$post({
		param: { id: deviceId },
		json: input,
	})
	return to_result<InterfaceJson>(res, 'Failed to add interface')
}

export async function update_interface(
	deviceId: string,
	ifaceId: string,
	input: { name?: string; kind?: string },
): Promise<Result<InterfaceJson, Error>> {
	const res = await client.devices[':id'].interfaces[':ifaceId'].$patch({
		param: { id: deviceId, ifaceId },
		json: input,
	})
	return to_result<InterfaceJson>(res, 'Failed to update interface')
}
