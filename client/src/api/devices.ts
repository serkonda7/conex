/**
 * Devices API wrappers: typed devices/interfaces calls over the hono RPC
 * client. Errors surface as `Result.err` with the server's `{ error }`
 * message.
 */
import type { Result } from 'better-result'
import type { DeviceRow, InterfaceJson } from 'server/src/db/devices'
import type {
	DeviceCreate,
	DeviceListQuery,
	DeviceStatus,
	DeviceUpdate,
	InterfaceUpdate,
	Page,
} from 'shared/src/types'
import { by_id, client, failed, getPage, paging, to_query, to_result } from './client'

export type { DeviceRow, InterfaceJson }

export type DeviceSort = DeviceListQuery['sort']

export async function fetch_devices(
	filters?: Partial<DeviceListQuery>,
): Promise<Result<Page<DeviceRow>, Error>> {
	return getPage<DeviceRow>(
		client.devices.$get({
			query: to_query({
				...paging(filters),
				site: filters?.site,
				rack: filters?.rack,
				tenant: filters?.tenant,
				tenant_group: filters?.tenant_group,
				status: filters?.status,
				placed: filters?.placed,
				sort: filters?.sort ?? 'name',
				order: filters?.order ?? 'asc',
			}),
		}),
		failed.list('noun.device'),
	)
}

export async function fetch_device(id: number): Promise<Result<DeviceRow, Error>> {
	const res = await client.devices[':id'].$get(by_id(id))
	return to_result<DeviceRow>(res, failed.load('noun.device'))
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
	return to_result<DeviceRow>(res, failed.create('noun.device'))
}

export async function update_device(
	id: number,
	patch: DeviceUpdate,
): Promise<Result<DeviceRow, Error>> {
	const res = await client.devices[':id'].$patch({ ...by_id(id), json: patch })
	return to_result<DeviceRow>(res, failed.update('noun.device'))
}

export async function delete_device(id: number): Promise<Result<unknown, Error>> {
	const res = await client.devices[':id'].$delete(by_id(id))
	return to_result<unknown>(res, failed.delete('noun.device'))
}

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export async function fetch_interfaces(deviceId: number): Promise<Result<InterfaceJson[], Error>> {
	const res = await client.devices[':id'].interfaces.$get(by_id(deviceId))
	return to_result<InterfaceJson[]>(res, failed.list('noun.interface'))
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
	return to_result<InterfaceJson>(res, failed.update('noun.interface'))
}
