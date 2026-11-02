/**
 * Devices API wrappers: typed devices/interfaces calls over the hono RPC
 * client. Errors surface as `Result.err` with the server's `{ error }`
 * message.
 */
import { Result } from 'better-result'
import type { DeviceListItem, DeviceRow, InterfaceJson } from 'server/src/db/devices'
import type {
	DeviceCreate,
	DeviceListQuery,
	DeviceServiceJson,
	DeviceStatus,
	DeviceUpdate,
	InterfaceUpdate,
	Page,
	TemplateSyncApply,
	TemplateSyncPreview,
} from 'shared/src/types'
import { by_id, client, failed, getPage, paging, to_query, to_result } from './client'

export type { DeviceListItem, DeviceRow, InterfaceJson }

export type DeviceSort = DeviceListQuery['sort']

/** Device list rows of both kinds (physical devices and virtual machines). */
export async function fetch_device_list(
	filters?: Partial<DeviceListQuery>,
): Promise<Result<Page<DeviceListItem>, Error>> {
	return getPage<DeviceListItem>(
		client.devices.$get({
			query: to_query({
				...paging(filters),
				site: filters?.site,
				rack: filters?.rack,
				role: filters?.role,
				device_type: filters?.device_type,
				manufacturer: filters?.manufacturer,
				employee: filters?.employee,
				tenant: filters?.tenant,
				tenant_group: filters?.tenant_group,
				status: filters?.status,
				placed: filters?.placed,
				kind: filters?.kind,
				host: filters?.host,
				compatible_with: filters?.compatible_with,
				mountable: filters?.mountable,
				sort: filters?.sort ?? 'name',
				order: filters?.order ?? 'asc',
			}),
		}),
		failed.list('noun.device'),
	)
}

/** Physical devices only (no virtual machines). */
export function fetch_devices(
	filters?: Partial<Omit<DeviceListQuery, 'kind' | 'host'>>,
): Promise<Result<Page<DeviceRow>, Error>> {
	return fetch_device_list({ ...filters, kind: 'device' }) as Promise<
		Result<Page<DeviceRow>, Error>
	>
}

/** A physical device row of the device list. */
export type DeviceListDevice = Extract<DeviceListItem, { kind: 'device' }>

/** Every device of a device type, across all list pages. */
export async function fetch_all_devices_of_type(
	deviceTypeId: number,
): Promise<Result<DeviceListDevice[], Error>> {
	const rows: DeviceListDevice[] = []
	for (let page = 1; ; page++) {
		const result = await fetch_device_list({
			device_type: deviceTypeId,
			kind: 'device',
			page,
			limit: 200,
		})
		if (Result.isError(result)) {
			return result
		}
		rows.push(...result.value.items.filter((row) => row.kind === 'device'))
		if (rows.length >= result.value.total || result.value.items.length === 0) {
			return Result.ok(rows)
		}
	}
}

export async function fetch_device(id: number): Promise<Result<DeviceRow, Error>> {
	const res = await client.devices[':id'].$get(by_id(id))
	return to_result<DeviceRow>(res, failed.load('noun.device'))
}

/** Managed bundle of a device (via its role) and its tenant's SLA for it. */
export async function fetch_device_service(id: number): Promise<Result<DeviceServiceJson, Error>> {
	const res = await client.devices[':id'].service.$get(by_id(id))
	return to_result<DeviceServiceJson>(res, failed.load('noun.serviceLevel'))
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

/** How a device's ports differ from its device type. */
export async function fetch_template_sync(id: number): Promise<Result<TemplateSyncPreview, Error>> {
	const res = await client.devices[':id']['template-sync'].$get(by_id(id))
	return to_result<TemplateSyncPreview>(res, failed.load('noun.device'))
}

export async function apply_template_sync(
	id: number,
	input: TemplateSyncApply,
): Promise<Result<InterfaceJson[], Error>> {
	const res = await client.devices[':id']['template-sync'].$post({ ...by_id(id), json: input })
	return to_result<InterfaceJson[]>(res, failed.update('noun.device'))
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
