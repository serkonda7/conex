/**
 * Templates API wrappers: typed manufacturers/device-types/stubs calls over
 * the hono RPC client. Errors surface as `Result.err` with the server's
 * `{ error }` message.
 */
import type { Result } from 'better-result'
import type { RackTypeListRow, RackTypeRow } from 'server/src/db/rack_types'
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
	DeviceTypeUpdateApply,
	DeviceTypeUpdatePreview,
	DeviceTypeYamlExport,
	ManufacturerCreate,
	ManufacturerListQuery,
	ManufacturerUpdate,
	Page,
	RackTypeCreate,
	RackTypeListQuery,
	RackTypeUpdate,
	StubCreate,
	StubUpdate,
} from 'shared/src/types'
import { t } from '../i18n'
import {
	by_id,
	client,
	failed,
	fetch_all_pages,
	getPage,
	paging,
	to_query,
	to_result,
} from './client'

export type {
	DeviceTypeListRow,
	DeviceTypeRow,
	ManufacturerListRow,
	ManufacturerRow,
	RackTypeListRow,
	RackTypeRow,
	StubRow,
}

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

export async function fetch_manufacturer(id: number): Promise<Result<ManufacturerListRow, Error>> {
	const res = await client.manufacturers[':id'].$get(by_id(id))
	return to_result<ManufacturerListRow>(res, failed.load('noun.manufacturer'))
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
				role: filters?.role,
				full_depth: filters?.full_depth,
				eol: filters?.eol,
				sort: filters?.sort ?? 'model',
				order: filters?.order ?? 'asc',
			}),
		}),
		failed.list('noun.deviceType'),
	)
}

/** Every page of device types, for matching across the whole catalog. */
export async function fetch_all_device_types(
	filters?: Partial<DeviceTypeListQuery>,
): Promise<Result<DeviceTypeListRow[], Error>> {
	return fetch_all_pages((page) => fetch_device_types({ ...filters, ...page }))
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

/** The type as YAML, the base of an AI update. */
export async function fetch_device_type_yaml(
	id: number,
): Promise<Result<DeviceTypeYamlExport, Error>> {
	const res = await client['device-types'][':id'].yaml.$get(by_id(id))
	return to_result<DeviceTypeYamlExport>(res, failed.load('noun.deviceType'))
}

/** What applying `yaml` to the type would change; writes nothing. */
export async function preview_device_type_update(
	id: number,
	yaml: string,
): Promise<Result<DeviceTypeUpdatePreview, Error>> {
	const res = await client['device-types'][':id']['update-preview'].$post({
		...by_id(id),
		json: { yaml },
	})
	return to_result<DeviceTypeUpdatePreview>(res, t('deviceType.aiUpdate.previewFailed'))
}

export async function apply_device_type_update(
	id: number,
	json: DeviceTypeUpdateApply,
): Promise<Result<DeviceTypeRow, Error>> {
	const res = await client['device-types'][':id'].update.$post({ ...by_id(id), json })
	return to_result<DeviceTypeRow>(res, failed.update('noun.deviceType'))
}

export async function delete_device_type(id: number): Promise<Result<unknown, Error>> {
	const res = await client['device-types'][':id'].$delete(by_id(id))
	return to_result<unknown>(res, failed.delete('noun.deviceType'))
}

// ---------------------------------------------------------------------------
// Rack types
// ---------------------------------------------------------------------------

export type RackTypeSort = RackTypeListQuery['sort']

/** NetBox rack form-factor choices, from the shared rack-type contract. */
export type RackFormFactor = RackTypeCreate['form_factor']

export async function fetch_rack_types(
	filters?: Partial<RackTypeListQuery>,
): Promise<Result<Page<RackTypeListRow>, Error>> {
	return getPage<RackTypeListRow>(
		client['rack-types'].$get({
			query: to_query({
				...paging(filters),
				manufacturer: filters?.manufacturer,
				form_factor: filters?.form_factor,
				height: filters?.height,
				sort: filters?.sort ?? 'model',
				order: filters?.order ?? 'asc',
			}),
		}),
		failed.list('noun.rackType'),
	)
}

export async function fetch_rack_type(id: number): Promise<Result<RackTypeRow, Error>> {
	const res = await client['rack-types'][':id'].$get(by_id(id))
	return to_result<RackTypeRow>(res, failed.load('noun.rackType'))
}

export async function create_rack_type(input: RackTypeCreate): Promise<Result<RackTypeRow, Error>> {
	const res = await client['rack-types'].$post({ json: input })
	return to_result<RackTypeRow>(res, failed.create('noun.rackType'))
}

export async function update_rack_type(
	id: number,
	patch: RackTypeUpdate,
): Promise<Result<RackTypeRow, Error>> {
	const res = await client['rack-types'][':id'].$patch({ ...by_id(id), json: patch })
	return to_result<RackTypeRow>(res, failed.update('noun.rackType'))
}

export async function delete_rack_type(id: number): Promise<Result<unknown, Error>> {
	const res = await client['rack-types'][':id'].$delete(by_id(id))
	return to_result<unknown>(res, failed.delete('noun.rackType'))
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

export async function update_stub(
	deviceTypeId: number,
	stubId: number,
	patch: StubUpdate,
): Promise<Result<StubRow, Error>> {
	const res = await client['device-types'][':id'].stubs[':stubId'].$patch({
		param: { id: String(deviceTypeId), stubId: String(stubId) },
		json: patch,
	})
	return to_result<StubRow>(res, t('api.updateStubFailed'))
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
