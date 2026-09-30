/**
 * Racks API wrappers: typed racks/elevation calls over the hono RPC
 * client. Errors surface as `Result.err` with the server's `{ error }`
 * message.
 */
import type { Result } from 'better-result'
import type { RackRow } from 'server/src/db/racks'
import type {
	ElevationResponse,
	Page,
	RackCreate,
	RackListQuery,
	RackUpdate,
} from 'shared/src/types'
import { t } from '../i18n'
import { by_id, client, failed, getPage, paging, to_query, to_result } from './client'

export type { ElevationResponse, RackRow }

export type RackSort = RackListQuery['sort']

export async function fetch_racks(
	filters?: Partial<RackListQuery>,
): Promise<Result<Page<RackRow>, Error>> {
	return getPage<RackRow>(
		client.racks.$get({
			query: to_query({
				...paging(filters),
				site: filters?.site,
				location: filters?.location,
				tenant: filters?.tenant,
				tenant_group: filters?.tenant_group,
				sort: filters?.sort ?? 'name',
				order: filters?.order ?? 'asc',
			}),
		}),
		failed.list('noun.rack'),
	)
}

export async function fetch_rack(id: number): Promise<Result<RackRow, Error>> {
	const res = await client.racks[':id'].$get(by_id(id))
	return to_result<RackRow>(res, failed.load('noun.rack'))
}

export async function fetch_elevation(id: number): Promise<Result<ElevationResponse, Error>> {
	const res = await client.racks[':id'].elevation.$get(by_id(id))
	return to_result<ElevationResponse>(res, t('api.loadElevationFailed'))
}

export async function create_rack(input: RackCreate): Promise<Result<RackRow, Error>> {
	const res = await client.racks.$post({ json: input })
	return to_result<RackRow>(res, failed.create('noun.rack'))
}

export async function update_rack(id: number, patch: RackUpdate): Promise<Result<RackRow, Error>> {
	const res = await client.racks[':id'].$patch({ ...by_id(id), json: patch })
	return to_result<RackRow>(res, failed.update('noun.rack'))
}

export async function delete_rack(id: number): Promise<Result<unknown, Error>> {
	const res = await client.racks[':id'].$delete(by_id(id))
	return to_result<unknown>(res, failed.delete('noun.rack'))
}
