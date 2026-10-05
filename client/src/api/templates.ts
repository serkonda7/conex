/**
 * Templates API wrappers: typed manufacturers/device-types/stubs calls over
 * the hono RPC client. Errors surface as `Result.err` with the server's
 * `{ error }` message.
 */
import type { Result } from 'better-result'
import type {
	DeviceTypeListRow,
	DeviceTypeRow,
	ManufacturerListRow,
	ManufacturerRow,
	StubRow,
} from 'server/src/db/templates'
import type {
	DeviceTypeCreate,
	DeviceTypeListQuery,
	DeviceTypeUpdate,
	ManufacturerCreate,
	ManufacturerListQuery,
	ManufacturerUpdate,
	Page,
	StubCreate,
} from 'shared/src/types'
import { t } from '../i18n'
import { by_id, client, failed, getPage, paging, to_query, to_result } from './client'

export type { DeviceTypeListRow, DeviceTypeRow, ManufacturerListRow, ManufacturerRow, StubRow }

// ---------------------------------------------------------------------------
// Manufacturers
// ---------------------------------------------------------------------------

export type ManufacturerSort = ManufacturerListQuery['sort']

export async function fetch_manufacturers(
	filters?: Partial<ManufacturerListQuery>,
): Promise<Result<Page<ManufacturerListRow>, Error>> {
	return getPage<ManufacturerListRow>(
		client.manufacturers.$get({
			query: to_query({
				...paging(filters),
				sort: filters?.sort ?? 'name',
				order: filters?.order ?? 'asc',
			}),
		}),
		failed.list('noun.manufacturer'),
	)
}

export async function fetch_manufacturer(id: number): Promise<Result<ManufacturerRow, Error>> {
	const res = await client.manufacturers[':id'].$get(by_id(id))
	return to_result<ManufacturerRow>(res, failed.load('noun.manufacturer'))
}

export async function create_manufacturer(
	input: ManufacturerCreate,
): Promise<Result<ManufacturerRow, Error>> {
	const res = await client.manufacturers.$post({ json: input })
	return to_result<ManufacturerRow>(res, failed.create('noun.manufacturer'))
}

export async function update_manufacturer(
	id: number,
	patch: ManufacturerUpdate,
): Promise<Result<ManufacturerRow, Error>> {
	const res = await client.manufacturers[':id'].$patch({ ...by_id(id), json: patch })
	return to_result<ManufacturerRow>(res, failed.update('noun.manufacturer'))
}

export async function delete_manufacturer(id: number): Promise<Result<unknown, Error>> {
	const res = await client.manufacturers[':id'].$delete(by_id(id))
	return to_result<unknown>(res, failed.delete('noun.manufacturer'))
}

// ---------------------------------------------------------------------------
// Device types
// ---------------------------------------------------------------------------

export type DeviceTypeSort = DeviceTypeListQuery['sort']

/** NetBox rack form-factor choices, from the shared device-type contract. */
export type RackFormFactor = NonNullable<DeviceTypeCreate['form_factor']>

/**
 * Device-type create body. `u_height` / `is_full_depth` stay optional here
 * even though the shared output type marks them required: the server
 * defaults them.
 */
export type DeviceTypeCreateInput = Omit<DeviceTypeCreate, 'u_height' | 'is_full_depth'> & {
	u_height?: DeviceTypeCreate['u_height']
	is_full_depth?: DeviceTypeCreate['is_full_depth']
}

export async function fetch_device_types(
	filters?: Partial<DeviceTypeListQuery>,
): Promise<Result<Page<DeviceTypeListRow>, Error>> {
	return getPage<DeviceTypeListRow>(
		client['device-types'].$get({
			query: to_query({
				...paging(filters),
				manufacturer: filters?.manufacturer,
				kind: filters?.kind,
				sort: filters?.sort ?? 'model',
				order: filters?.order ?? 'asc',
			}),
		}),
		failed.list('noun.deviceType'),
	)
}

export async function fetch_device_type(id: number): Promise<Result<DeviceTypeRow, Error>> {
	const res = await client['device-types'][':id'].$get(by_id(id))
	return to_result<DeviceTypeRow>(res, failed.load('noun.deviceType'))
}

export async function create_device_type(
	input: DeviceTypeCreateInput,
): Promise<Result<DeviceTypeRow, Error>> {
	const res = await client['device-types'].$post({ json: input })
	return to_result<DeviceTypeRow>(res, failed.create('noun.deviceType'))
}

export async function update_device_type(
	id: number,
	patch: DeviceTypeUpdate,
): Promise<Result<DeviceTypeRow, Error>> {
	const res = await client['device-types'][':id'].$patch({ ...by_id(id), json: patch })
	return to_result<DeviceTypeRow>(res, failed.update('noun.deviceType'))
}

export async function delete_device_type(id: number): Promise<Result<unknown, Error>> {
	const res = await client['device-types'][':id'].$delete(by_id(id))
	return to_result<unknown>(res, failed.delete('noun.deviceType'))
}

// ---------------------------------------------------------------------------
// Stubs
// ---------------------------------------------------------------------------

/**
 * Stub create body. `count` / `kind` stay optional here even though the
 * shared output type marks them required: the server defaults them to
 * 1 / `ethernet`.
 */
export type StubCreateInput = Omit<StubCreate, 'count' | 'kind'> & {
	count?: StubCreate['count']
	kind?: StubCreate['kind']
}

export async function fetch_stubs(deviceTypeId: number): Promise<Result<StubRow[], Error>> {
	const res = await client['device-types'][':id'].stubs.$get(by_id(deviceTypeId))
	return to_result<StubRow[]>(res, t('api.loadStubsFailed'))
}

export async function create_stub(
	deviceTypeId: number,
	input: StubCreateInput,
): Promise<Result<StubRow, Error>> {
	const res = await client['device-types'][':id'].stubs.$post({
		...by_id(deviceTypeId),
		json: input,
	})
	return to_result<StubRow>(res, t('api.createStubFailed'))
}

export async function delete_stub(
	deviceTypeId: number,
	stubId: number,
): Promise<Result<unknown, Error>> {
	const res = await client['device-types'][':id'].stubs[':stubId'].$delete({
		param: { id: String(deviceTypeId), stubId: String(stubId) },
	})
	return to_result<unknown>(res, t('api.deleteStubFailed'))
}
