/**
 * P3 API wrappers: typed manufacturers/device-types/stubs/preview calls over
 * the hono RPC client. Errors surface as `Result.err` with the server's
 * `{ error }` message, matching the auth wrappers in `api_auth.ts`.
 */
import type { Result } from 'better-result'
import type { DeviceTypeRow, ManufacturerRow, StubRow } from 'server/src/db/templates'
import type { StubPreviewResponse } from 'shared/src/schemas'
import { client, to_result } from './api'
import type { ApiResponse } from './util/api_error'

export interface Page<T> {
	items: T[]
	total: number
	page: number
	limit: number
}

export type { DeviceTypeRow, ManufacturerRow, StubPreviewResponse, StubRow }

async function getPage<T>(
	req: Promise<ApiResponse>,
	fallback: string,
): Promise<Result<Page<T>, Error>> {
	return to_result<Page<T>>(await req, fallback)
}

// ---------------------------------------------------------------------------
// Manufacturers
// ---------------------------------------------------------------------------

export type ManufacturerSort = 'name' | 'slug' | 'description'

export interface ManufacturerFilters {
	search?: string
	sort?: ManufacturerSort
	order?: 'asc' | 'desc'
}

export async function fetch_manufacturers(
	filters: string | ManufacturerFilters = '',
): Promise<Result<Page<ManufacturerRow>, Error>> {
	const f: ManufacturerFilters = typeof filters === 'string' ? { search: filters } : filters
	return getPage<ManufacturerRow>(
		client.manufacturers.$get({
			query: {
				search: f.search ?? '',
				page: '1',
				limit: '200',
				sort: f.sort ?? 'name',
				order: f.order ?? 'asc',
			},
		}),
		'Failed to load manufacturers',
	)
}

export async function create_manufacturer(
	name: string,
	slug: string,
	description?: string,
): Promise<Result<ManufacturerRow, Error>> {
	const res = await client.manufacturers.$post({
		json: { name, slug, description: description || undefined },
	})
	return to_result<ManufacturerRow>(res, 'Failed to create manufacturer')
}

export async function fetch_manufacturer(id: number): Promise<Result<ManufacturerRow, Error>> {
	const res = await client.manufacturers[':id'].$get({ param: { id: String(id) } })
	return to_result<ManufacturerRow>(res, 'Failed to load manufacturer')
}

export interface ManufacturerUpdateInput {
	name?: string
	slug?: string
	description?: string | null
}

export async function update_manufacturer(
	id: number,
	patch: ManufacturerUpdateInput,
): Promise<Result<ManufacturerRow, Error>> {
	const res = await client.manufacturers[':id'].$patch({
		param: { id: String(id) },
		json: patch,
	})
	return to_result<ManufacturerRow>(res, 'Failed to update manufacturer')
}

export async function delete_manufacturer(id: number): Promise<Result<unknown, Error>> {
	const res = await client.manufacturers[':id'].$delete({ param: { id: String(id) } })
	return to_result<unknown>(res, 'Failed to delete manufacturer')
}

// ---------------------------------------------------------------------------
// Device types
// ---------------------------------------------------------------------------

export type DeviceTypeSort = 'model' | 'slug'

export interface DeviceTypeFilters {
	search?: string
	manufacturer?: number
	sort?: DeviceTypeSort
	order?: 'asc' | 'desc'
}

export async function fetch_device_types(
	filters?: number | DeviceTypeFilters,
): Promise<Result<Page<DeviceTypeRow>, Error>> {
	const f: DeviceTypeFilters =
		typeof filters === 'number' ? { manufacturer: filters } : (filters ?? {})
	return getPage<DeviceTypeRow>(
		client['device-types'].$get({
			query: {
				search: f.search ?? '',
				page: '1',
				limit: '200',
				manufacturer: f.manufacturer === undefined ? undefined : String(f.manufacturer),
				sort: f.sort ?? 'model',
				order: f.order ?? 'asc',
			},
		}),
		'Failed to load device types',
	)
}

export async function create_device_type(input: {
	manufacturer_id: number
	model: string
	slug: string
	u_height?: number
	description?: string
	form_factor?:
		| '2-post frame'
		| '4-post frame'
		| '4-post cabinet'
		| 'wall-mounted frame'
		| 'wall-mounted cabinet'
		| 'wall-mounted swing-out'
		| 'outdoor cabinet'
	width?: 10 | 19 | 23
}): Promise<Result<DeviceTypeRow, Error>> {
	const res = await client['device-types'].$post({ json: input })
	return to_result<DeviceTypeRow>(res, 'Failed to create device type')
}

export async function delete_device_type(id: number): Promise<Result<unknown, Error>> {
	const res = await client['device-types'][':id'].$delete({ param: { id: String(id) } })
	return to_result<unknown>(res, 'Failed to delete device type')
}

export async function fetch_device_type(id: number): Promise<Result<DeviceTypeRow, Error>> {
	const res = await client['device-types'][':id'].$get({ param: { id: String(id) } })
	return to_result<DeviceTypeRow>(res, 'Failed to load device type')
}

export interface DeviceTypeUpdateInput {
	manufacturer_id?: number
	model?: string
	slug?: string
	u_height?: number
	form_factor?:
		| '2-post frame'
		| '4-post frame'
		| '4-post cabinet'
		| 'wall-mounted frame'
		| 'wall-mounted cabinet'
		| 'wall-mounted swing-out'
		| 'outdoor cabinet'
		| null
	width?: 10 | 19 | 23 | null
	description?: string | null
}

export async function update_device_type(
	id: number,
	patch: DeviceTypeUpdateInput,
): Promise<Result<DeviceTypeRow, Error>> {
	const res = await client['device-types'][':id'].$patch({
		param: { id: String(id) },
		json: patch,
	})
	return to_result<DeviceTypeRow>(res, 'Failed to update device type')
}

// ---------------------------------------------------------------------------
// Stubs + preview
// ---------------------------------------------------------------------------

export async function fetch_stubs(deviceTypeId: number): Promise<Result<StubRow[], Error>> {
	const res = await client['device-types'][':id'].stubs.$get({
		param: { id: String(deviceTypeId) },
	})
	return to_result<StubRow[]>(res, 'Failed to load interface stubs')
}

export async function create_stub(
	deviceTypeId: number,
	input: { prefix: string; count: number; kind?: string },
): Promise<Result<StubRow, Error>> {
	const res = await client['device-types'][':id'].stubs.$post({
		param: { id: String(deviceTypeId) },
		json: input,
	})
	return to_result<StubRow>(res, 'Failed to create interface stub')
}

export async function delete_stub(
	deviceTypeId: number,
	stubId: number,
): Promise<Result<unknown, Error>> {
	const res = await client['device-types'][':id'].stubs[':stubId'].$delete({
		param: { id: String(deviceTypeId), stubId: String(stubId) },
	})
	return to_result<unknown>(res, 'Failed to delete interface stub')
}

export async function fetch_type_preview(
	deviceTypeId: number,
): Promise<Result<StubPreviewResponse, Error>> {
	const res = await client['device-types'][':id'].preview.$get({
		param: { id: String(deviceTypeId) },
	})
	return to_result<StubPreviewResponse>(res, 'Failed to load stub preview')
}

export async function fetch_adhoc_preview(
	prefix: string,
	count: number,
): Promise<Result<StubPreviewResponse, Error>> {
	const res = await client['device-types'].preview.$get({
		query: { prefix, count: String(count) },
	})
	return to_result<StubPreviewResponse>(res, 'Failed to load stub preview')
}
