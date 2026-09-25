/**
 * Racks API wrappers: typed racks/elevation calls over the hono RPC
 * client. Errors surface as `Result.err` with the server's `{ error }`
 * message, matching the auth wrappers in `api_auth.ts`.
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
import { client, getPage, to_query, to_result } from './api'
import { t, tp } from './i18n'

export type { ElevationResponse, RackRow }

// ---------------------------------------------------------------------------
// Racks
// ---------------------------------------------------------------------------

export type RackSort = RackListQuery['sort']

export type RackFilters = Partial<RackListQuery>

export type RackCreateInput = RackCreate

export type RackUpdateInput = RackUpdate

export async function fetch_racks(filters?: RackFilters): Promise<Result<Page<RackRow>, Error>> {
	return getPage<RackRow>(
		client.racks.$get({
			query: to_query({
				search: filters?.search ?? '',
				page: 1,
				limit: 200,
				site: filters?.site,
				location: filters?.location,
				tenant: filters?.tenant,
				sort: filters?.sort ?? 'name',
				order: filters?.order ?? 'asc',
			}),
		}),
		tp('api.loadFailed', 2, { noun: tp('noun.rack', 2) }),
	)
}

export async function fetch_rack(id: number): Promise<Result<RackRow, Error>> {
	const res = await client.racks[':id'].$get({ param: { id: String(id) } })
	return to_result<RackRow>(res, tp('api.loadFailed', 1, { noun: tp('noun.rack', 1) }))
}

export async function fetch_elevation(id: number): Promise<Result<ElevationResponse, Error>> {
	const res = await client.racks[':id'].elevation.$get({ param: { id: String(id) } })
	return to_result<ElevationResponse>(res, t('api.loadElevationFailed'))
}

export async function create_rack(input: RackCreateInput): Promise<Result<RackRow, Error>> {
	const res = await client.racks.$post({
		json: {
			name: input.name,
			site_id: input.site_id,
			location_id: input.location_id,
			tenant_id: input.tenant_id,
			rack_type_id: input.rack_type_id,
			description: input.description || undefined,
		},
	})
	return to_result<RackRow>(res, t('api.createFailed', { noun: tp('noun.rack', 1) }))
}

export async function update_rack(
	id: number,
	patch: RackUpdateInput,
): Promise<Result<RackRow, Error>> {
	const res = await client.racks[':id'].$patch({
		param: { id: String(id) },
		json: patch,
	})
	return to_result<RackRow>(res, t('api.updateFailed', { noun: tp('noun.rack', 1) }))
}

export async function delete_rack(id: number): Promise<Result<unknown, Error>> {
	const res = await client.racks[':id'].$delete({ param: { id: String(id) } })
	return to_result<unknown>(res, t('api.deleteFailed', { noun: tp('noun.rack', 1) }))
}
