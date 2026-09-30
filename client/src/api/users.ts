/**
 * Users API wrappers: admin-only account management over the hono RPC
 * client. Errors surface as `Result.err` with the server's `{ error }`
 * message.
 */
import type { Result } from 'better-result'
import type { Page, UserCreate, UserJson, UserListQuery, UserUpdate } from 'shared/src/types'
import { by_id, client, failed, getPage, paging, to_query, to_result } from './client'

export type { UserJson }
export type UserRole = UserJson['role']

export async function fetch_users(
	filters?: Partial<UserListQuery>,
): Promise<Result<Page<UserJson>, Error>> {
	return getPage<UserJson>(
		client.users.$get({
			query: to_query({ ...paging(filters), role: filters?.role, tenant: filters?.tenant }),
		}),
		failed.list('noun.user'),
	)
}

export async function fetch_user(id: number): Promise<Result<UserJson, Error>> {
	const res = await client.users[':id'].$get(by_id(id))
	return to_result<UserJson>(res, failed.load('noun.user'))
}

/**
 * User create body. `role` stays optional here even though the shared
 * output type marks it required: the server defaults it to `viewer`.
 */
export type UserCreateInput = Omit<UserCreate, 'role'> & {
	role?: UserCreate['role']
}

export async function create_user(input: UserCreateInput): Promise<Result<UserJson, Error>> {
	const res = await client.users.$post({ json: input })
	return to_result<UserJson>(res, failed.create('noun.user'))
}

export async function update_user(id: number, patch: UserUpdate): Promise<Result<UserJson, Error>> {
	const res = await client.users[':id'].$patch({ ...by_id(id), json: patch })
	return to_result<UserJson>(res, failed.update('noun.user'))
}

export async function delete_user(id: number): Promise<Result<unknown, Error>> {
	const res = await client.users[':id'].$delete(by_id(id))
	return to_result<unknown>(res, failed.delete('noun.user'))
}
