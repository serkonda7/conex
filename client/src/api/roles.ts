/**
 * Roles API wrappers (`users.manage`): permission bundles assigned to
 * users, over the hono RPC client. Errors surface as `Result.err` with the
 * server's `{ error }` message.
 */
import type { Result } from 'better-result'
import type { Page, RoleCreate, RoleJson, RoleListQuery, RoleUpdate } from 'shared/src/types'
import { by_id, client, failed, getPage, paging, to_query, to_result } from './client'

export type { RoleJson }

export async function fetch_roles(
	filters?: Partial<RoleListQuery>,
): Promise<Result<Page<RoleJson>, Error>> {
	return getPage<RoleJson>(
		client.roles.$get({ query: to_query({ ...paging(filters) }) }),
		failed.list('noun.role'),
	)
}

export async function fetch_role(id: number): Promise<Result<RoleJson, Error>> {
	const res = await client.roles[':id'].$get(by_id(id))
	return to_result<RoleJson>(res, failed.load('noun.role'))
}

export async function create_role(input: RoleCreate): Promise<Result<RoleJson, Error>> {
	const res = await client.roles.$post({ json: input })
	return to_result<RoleJson>(res, failed.create('noun.role'))
}

export async function update_role(id: number, patch: RoleUpdate): Promise<Result<RoleJson, Error>> {
	const res = await client.roles[':id'].$patch({ ...by_id(id), json: patch })
	return to_result<RoleJson>(res, failed.update('noun.role'))
}

export async function delete_role(id: number): Promise<Result<unknown, Error>> {
	const res = await client.roles[':id'].$delete(by_id(id))
	return to_result<unknown>(res, failed.delete('noun.role'))
}
