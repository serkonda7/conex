/**
 * Device roles API wrappers: typed device-roles calls over the hono RPC
 * client. Errors surface as `Result.err` with the server's `{ error }`
 * message.
 */
import type { Result } from 'better-result'
import type { DeviceRoleListRow, DeviceRoleRow } from 'server/src/db/device_roles'
import type {
	DeviceRoleCreate,
	DeviceRoleListQuery,
	DeviceRoleUpdate,
	Page,
} from 'shared/src/types'
import { by_id, client, failed, getPage, paging, to_query, to_result } from './client'

export type { DeviceRoleListRow, DeviceRoleRow }

export type DeviceRoleSort = DeviceRoleListQuery['sort']

export async function fetch_device_roles(
	filters?: Partial<DeviceRoleListQuery>,
): Promise<Result<Page<DeviceRoleListRow>, Error>> {
	return getPage<DeviceRoleListRow>(
		client['device-roles'].$get({
			query: to_query({
				...paging(filters),
				sort: filters?.sort ?? 'name',
				order: filters?.order ?? 'asc',
			}),
		}),
		failed.list('noun.deviceRole'),
	)
}

export async function fetch_device_role(id: number): Promise<Result<DeviceRoleRow, Error>> {
	const res = await client['device-roles'][':id'].$get(by_id(id))
	return to_result<DeviceRoleRow>(res, failed.load('noun.deviceRole'))
}

export async function create_device_role(
	input: DeviceRoleCreate,
): Promise<Result<DeviceRoleRow, Error>> {
	const res = await client['device-roles'].$post({ json: input })
	return to_result<DeviceRoleRow>(res, failed.create('noun.deviceRole'))
}

export async function update_device_role(
	id: number,
	patch: DeviceRoleUpdate,
): Promise<Result<DeviceRoleRow, Error>> {
	const res = await client['device-roles'][':id'].$patch({ ...by_id(id), json: patch })
	return to_result<DeviceRoleRow>(res, failed.update('noun.deviceRole'))
}

export async function delete_device_role(id: number): Promise<Result<unknown, Error>> {
	const res = await client['device-roles'][':id'].$delete(by_id(id))
	return to_result<unknown>(res, failed.delete('noun.deviceRole'))
}
