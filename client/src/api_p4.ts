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

export type DeviceSort = 'name'

export interface DeviceFilters {
	search?: string
	site?: number
	rack?: number
	tenant?: number
	status?: 'active' | 'planned' | 'staged' | 'decommissioned'
	sort?: DeviceSort
	order?: 'asc' | 'desc'
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
				site: filters?.site === undefined ? undefined : String(filters.site),
				rack: filters?.rack === undefined ? undefined : String(filters.rack),
				tenant: filters?.tenant === undefined ? undefined : String(filters.tenant),
				status: filters?.status,
				sort: filters?.sort ?? 'name',
				order: filters?.order ?? 'asc',
			},
		}),
		'Failed to load devices',
	)
}

export async function fetch_device(id: number): Promise<Result<DeviceRow, Error>> {
	const res = await client.devices[':id'].$get({ param: { id: String(id) } })
	return to_result<DeviceRow>(res, 'Failed to load device')
}

export async function create_device(input: {
	device_type_id: number
	name: string
	site_id?: number | null
	location_id?: number | null
	rack_id?: number | null
	face?: 'front' | 'rear' | null
	position_u?: number | null
	shelf_id?: number | null
	asset_tag?: string | null
	serial?: string
	tenant_id?: number | null
	description?: string
	status?: 'active' | 'planned' | 'staged' | 'decommissioned'
}): Promise<Result<DeviceRow, Error>> {
	const res = await client.devices.$post({ json: input })
	return to_result<DeviceRow>(res, 'Failed to create device')
}

export interface DeviceUpdateInput {
	name?: string
	status?: 'active' | 'planned' | 'staged' | 'decommissioned'
	site_id?: number | null
	location_id?: number | null
	rack_id?: number | null
	face?: 'front' | 'rear' | null
	position_u?: number | null
	shelf_id?: number | null
	serial?: string | null
	asset_tag?: string | null
	tenant_id?: number | null
	description?: string | null
}

export async function update_device(
	id: number,
	patch: DeviceUpdateInput,
): Promise<Result<DeviceRow, Error>> {
	const res = await client.devices[':id'].$patch({
		param: { id: String(id) },
		json: patch,
	})
	return to_result<DeviceRow>(res, 'Failed to update device')
}

export async function move_device(
	id: number,
	input: { rack_id?: number | null; position_u?: number | null; shelf_id?: number | null },
): Promise<Result<DeviceRow, Error>> {
	const res = await client.devices[':id'].move.$post({ param: { id: String(id) }, json: input })
	return to_result<DeviceRow>(res, 'Failed to move device')
}

export async function delete_device(id: number): Promise<Result<unknown, Error>> {
	const res = await client.devices[':id'].$delete({ param: { id: String(id) } })
	return to_result<unknown>(res, 'Failed to delete device')
}

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export async function fetch_interfaces(deviceId: number): Promise<Result<InterfaceJson[], Error>> {
	const res = await client.devices[':id'].interfaces.$get({ param: { id: String(deviceId) } })
	return to_result<InterfaceJson[]>(res, 'Failed to load interfaces')
}

export async function add_interface(
	deviceId: number,
	input: { name: string; kind?: string },
): Promise<Result<InterfaceJson, Error>> {
	const res = await client.devices[':id'].interfaces.$post({
		param: { id: String(deviceId) },
		json: input,
	})
	return to_result<InterfaceJson>(res, 'Failed to add interface')
}

export async function update_interface(
	deviceId: number,
	ifaceId: number,
	input: { name?: string; kind?: string },
): Promise<Result<InterfaceJson, Error>> {
	const res = await client.devices[':id'].interfaces[':ifaceId'].$patch({
		param: { id: String(deviceId), ifaceId: String(ifaceId) },
		json: input,
	})
	return to_result<InterfaceJson>(res, 'Failed to update interface')
}
