/**
 * Devices API wrappers: typed devices/interfaces calls over the hono RPC client.
 * Errors surface as `Result.err` with the server's `{ error }` message,
 * matching the auth wrappers in `api_auth.ts`.
 */
import type { Result } from 'better-result'
import type { DeviceRow, InterfaceJson } from 'server/src/db/devices'
import type {
	DeviceCreate,
	DeviceListQuery,
	DeviceMove,
	DeviceStatus,
	DeviceUpdate,
	InterfaceCreate,
	InterfaceListQuery,
	InterfaceUpdate,
	Page,
} from 'shared/src/types'
import { client, getPage, to_query, to_result } from './api'
import { t, tp } from './i18n'

export type { DeviceRow, InterfaceJson }

export type DeviceSort = DeviceListQuery['sort']

export type DeviceFilters = Partial<DeviceListQuery>

export async function fetch_devices(
	filters?: DeviceFilters,
): Promise<Result<Page<DeviceRow>, Error>> {
	return getPage<DeviceRow>(
		client.devices.$get({
			query: to_query({
				search: filters?.search ?? '',
				page: 1,
				limit: 200,
				site: filters?.site,
				rack: filters?.rack,
				tenant: filters?.tenant,
				status: filters?.status,
				placed: filters?.placed,
				sort: filters?.sort ?? 'name',
				order: filters?.order ?? 'asc',
			}),
		}),
		tp('api.loadFailed', 2, { noun: tp('noun.device', 2) }),
	)
}

export async function fetch_device(id: number): Promise<Result<DeviceRow, Error>> {
	const res = await client.devices[':id'].$get({ param: { id: String(id) } })
	return to_result<DeviceRow>(res, tp('api.loadFailed', 1, { noun: tp('noun.device', 1) }))
}

/**
 * Device create body. `status` stays optional here even though the shared
 * output type marks it required: the server defaults it to `active`.
 */
export type DeviceCreateInput = Omit<DeviceCreate, 'status'> & {
	status?: DeviceStatus
}

export async function create_device(input: DeviceCreateInput): Promise<Result<DeviceRow, Error>> {
	const res = await client.devices.$post({ json: input })
	return to_result<DeviceRow>(res, t('api.createFailed', { noun: tp('noun.device', 1) }))
}

export type DeviceUpdateInput = DeviceUpdate

export async function update_device(
	id: number,
	patch: DeviceUpdateInput,
): Promise<Result<DeviceRow, Error>> {
	const res = await client.devices[':id'].$patch({
		param: { id: String(id) },
		json: patch,
	})
	return to_result<DeviceRow>(res, t('api.updateFailed', { noun: tp('noun.device', 1) }))
}

export async function move_device(
	id: number,
	input: DeviceMove,
): Promise<Result<DeviceRow, Error>> {
	const res = await client.devices[':id'].move.$post({ param: { id: String(id) }, json: input })
	return to_result<DeviceRow>(res, t('api.moveDeviceFailed'))
}

export async function delete_device(id: number): Promise<Result<unknown, Error>> {
	const res = await client.devices[':id'].$delete({ param: { id: String(id) } })
	return to_result<unknown>(res, t('api.deleteFailed', { noun: tp('noun.device', 1) }))
}

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface InterfaceListItem extends InterfaceJson {
	device_name: string
}

export type InterfaceFilters = Partial<InterfaceListQuery>

export async function fetch_all_interfaces(
	filters?: InterfaceFilters,
): Promise<Result<Page<InterfaceListItem>, Error>> {
	return getPage<InterfaceListItem>(
		client.interfaces.$get({
			query: to_query({
				search: filters?.search ?? '',
				page: 1,
				limit: 200,
				device: filters?.device,
				connected: filters?.connected,
			}),
		}),
		tp('api.loadFailed', 2, { noun: tp('noun.interface', 2) }),
	)
}

export async function fetch_interfaces(deviceId: number): Promise<Result<InterfaceJson[], Error>> {
	const res = await client.devices[':id'].interfaces.$get({ param: { id: String(deviceId) } })
	return to_result<InterfaceJson[]>(
		res,
		tp('api.loadFailed', 2, { noun: tp('noun.interface', 2) }),
	)
}

/**
 * Interface create body. `kind` stays optional here even though the shared
 * output type marks it required: the server defaults it to `ethernet`.
 */
export type InterfaceCreateInput = Omit<InterfaceCreate, 'kind'> & {
	kind?: InterfaceCreate['kind']
}

export async function add_interface(
	deviceId: number,
	input: InterfaceCreateInput,
): Promise<Result<InterfaceJson, Error>> {
	const res = await client.devices[':id'].interfaces.$post({
		param: { id: String(deviceId) },
		json: input,
	})
	return to_result<InterfaceJson>(res, t('api.addInterfaceFailed'))
}

export async function update_interface(
	deviceId: number,
	ifaceId: number,
	input: InterfaceUpdate,
): Promise<Result<InterfaceJson, Error>> {
	const res = await client.devices[':id'].interfaces[':ifaceId'].$patch({
		param: { id: String(deviceId), ifaceId: String(ifaceId) },
		json: input,
	})
	return to_result<InterfaceJson>(res, t('api.updateFailed', { noun: tp('noun.interface', 1) }))
}
