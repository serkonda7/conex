/**
 * Templates API wrappers: typed manufacturers/device-types/stubs calls over
 * the hono RPC client. Errors surface as `Result.err` with the server's
 * `{ error }` message, matching the auth wrappers in `api_auth.ts`.
 */
import type { Result } from 'better-result'
import type { DeviceTypeRow, ManufacturerRow, StubRow } from 'server/src/db/templates'
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
import { client, getPage, to_query, to_result } from './api'
import { t, tp } from './i18n'

export type { DeviceTypeRow, ManufacturerRow, StubRow }

// ---------------------------------------------------------------------------
// Manufacturers
// ---------------------------------------------------------------------------

export type ManufacturerSort = ManufacturerListQuery['sort']

export type ManufacturerFilters = Partial<ManufacturerListQuery>

export async function fetch_manufacturers(
	filters: string | ManufacturerFilters = '',
): Promise<Result<Page<ManufacturerRow>, Error>> {
	const f: ManufacturerFilters = typeof filters === 'string' ? { search: filters } : filters
	return getPage<ManufacturerRow>(
		client.manufacturers.$get({
			query: to_query({
				search: f.search ?? '',
				page: 1,
				limit: 200,
				sort: f.sort ?? 'name',
				order: f.order ?? 'asc',
			}),
		}),
		tp('api.loadFailed', 2, { noun: tp('noun.manufacturer', 2) }),
	)
}

export async function create_manufacturer(
	name: ManufacturerCreate['name'],
	description?: ManufacturerCreate['description'],
): Promise<Result<ManufacturerRow, Error>> {
	const res = await client.manufacturers.$post({
		json: { name, description: description || undefined },
	})
	return to_result<ManufacturerRow>(
		res,
		t('api.createFailed', { noun: tp('noun.manufacturer', 1) }),
	)
}

export async function fetch_manufacturer(id: number): Promise<Result<ManufacturerRow, Error>> {
	const res = await client.manufacturers[':id'].$get({ param: { id: String(id) } })
	return to_result<ManufacturerRow>(
		res,
		tp('api.loadFailed', 1, { noun: tp('noun.manufacturer', 1) }),
	)
}

export type ManufacturerUpdateInput = ManufacturerUpdate

export async function update_manufacturer(
	id: number,
	patch: ManufacturerUpdateInput,
): Promise<Result<ManufacturerRow, Error>> {
	const res = await client.manufacturers[':id'].$patch({
		param: { id: String(id) },
		json: patch,
	})
	return to_result<ManufacturerRow>(
		res,
		t('api.updateFailed', { noun: tp('noun.manufacturer', 1) }),
	)
}

export async function delete_manufacturer(id: number): Promise<Result<unknown, Error>> {
	const res = await client.manufacturers[':id'].$delete({ param: { id: String(id) } })
	return to_result<unknown>(res, t('api.deleteFailed', { noun: tp('noun.manufacturer', 1) }))
}

// ---------------------------------------------------------------------------
// Device types
// ---------------------------------------------------------------------------

export type DeviceTypeSort = DeviceTypeListQuery['sort']

export type DeviceTypeFilters = Partial<DeviceTypeListQuery>

export async function fetch_device_types(
	filters?: number | DeviceTypeFilters,
): Promise<Result<Page<DeviceTypeRow>, Error>> {
	const f: DeviceTypeFilters =
		typeof filters === 'number' ? { manufacturer: filters } : (filters ?? {})
	return getPage<DeviceTypeRow>(
		client['device-types'].$get({
			query: to_query({
				search: f.search ?? '',
				page: 1,
				limit: 200,
				manufacturer: f.manufacturer,
				kind: f.kind,
				sort: f.sort ?? 'model',
				order: f.order ?? 'asc',
			}),
		}),
		tp('api.loadFailed', 2, { noun: tp('noun.deviceType', 2) }),
	)
}

/** NetBox rack form-factor choices, from the shared device-type contract. */
export type RackFormFactor = NonNullable<DeviceTypeCreate['form_factor']>

/** Rack width choices in inches, from the shared device-type contract. */
export type RackWidth = NonNullable<DeviceTypeCreate['width']>

/**
 * Device-type create body. `u_height` / `is_full_depth` stay optional here
 * even though the shared output type marks them required: the server
 * defaults them.
 */
export type DeviceTypeCreateInput = Omit<DeviceTypeCreate, 'u_height' | 'is_full_depth'> & {
	u_height?: DeviceTypeCreate['u_height']
	is_full_depth?: DeviceTypeCreate['is_full_depth']
}

export async function create_device_type(
	input: DeviceTypeCreateInput,
): Promise<Result<DeviceTypeRow, Error>> {
	const res = await client['device-types'].$post({ json: input })
	return to_result<DeviceTypeRow>(res, t('api.createFailed', { noun: tp('noun.deviceType', 1) }))
}

export async function delete_device_type(id: number): Promise<Result<unknown, Error>> {
	const res = await client['device-types'][':id'].$delete({ param: { id: String(id) } })
	return to_result<unknown>(res, t('api.deleteFailed', { noun: tp('noun.deviceType', 1) }))
}

export async function fetch_device_type(id: number): Promise<Result<DeviceTypeRow, Error>> {
	const res = await client['device-types'][':id'].$get({ param: { id: String(id) } })
	return to_result<DeviceTypeRow>(
		res,
		tp('api.loadFailed', 1, { noun: tp('noun.deviceType', 1) }),
	)
}

export type DeviceTypeUpdateInput = DeviceTypeUpdate

export async function update_device_type(
	id: number,
	patch: DeviceTypeUpdateInput,
): Promise<Result<DeviceTypeRow, Error>> {
	const res = await client['device-types'][':id'].$patch({
		param: { id: String(id) },
		json: patch,
	})
	return to_result<DeviceTypeRow>(res, t('api.updateFailed', { noun: tp('noun.deviceType', 1) }))
}

// ---------------------------------------------------------------------------
// Stubs
// ---------------------------------------------------------------------------

export async function fetch_stubs(deviceTypeId: number): Promise<Result<StubRow[], Error>> {
	const res = await client['device-types'][':id'].stubs.$get({
		param: { id: String(deviceTypeId) },
	})
	return to_result<StubRow[]>(res, t('api.loadStubsFailed'))
}

/**
 * Stub create body. `count` / `kind` stay optional here even though the
 * shared output type marks them required: the server defaults them to
 * 1 / `ethernet`.
 */
export type StubCreateInput = Omit<StubCreate, 'count' | 'kind'> & {
	count?: StubCreate['count']
	kind?: StubCreate['kind']
}

export async function create_stub(
	deviceTypeId: number,
	input: StubCreateInput,
): Promise<Result<StubRow, Error>> {
	const res = await client['device-types'][':id'].stubs.$post({
		param: { id: String(deviceTypeId) },
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
