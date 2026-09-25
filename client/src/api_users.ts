/**
 * Users API wrappers: admin-only account management over the hono RPC
 * client. Errors surface as `Result.err` with the server's `{ error }`
 * message, matching the other API modules.
 */
import type { Result } from 'better-result'
import type { Page, UserCreate, UserJson, UserListQuery, UserUpdate } from 'shared/src/types'
import { client, to_query, to_result } from './api'
import { t, tp } from './i18n'

export type { UserJson }
export type UserRole = UserJson['role']

export type UserFilters = Partial<UserListQuery>

export async function fetch_users(filters?: UserFilters): Promise<Result<Page<UserJson>, Error>> {
	const res = await client.users.$get({
		query: to_query({
			search: filters?.search ?? '',
			page: filters?.page ?? 1,
			limit: filters?.limit ?? 200,
			role: filters?.role,
			tenant: filters?.tenant,
		}),
	})
	return to_result<Page<UserJson>>(res, tp('api.loadFailed', 2, { noun: tp('noun.user', 2) }))
}

export async function fetch_user(id: number): Promise<Result<UserJson, Error>> {
	const res = await client.users[':id'].$get({ param: { id: String(id) } })
	return to_result<UserJson>(res, tp('api.loadFailed', 1, { noun: tp('noun.user', 1) }))
}

/**
 * User create body. `role` stays optional here even though the shared
 * output type marks it required: the server defaults it to `viewer`.
 */
export type UserCreateInput = Omit<UserCreate, 'role'> & {
	role?: UserCreate['role']
}

export async function create_user(input: UserCreateInput): Promise<Result<UserJson, Error>> {
	const res = await client.users.$post({
		json: {
			username: input.username,
			password: input.password,
			role: input.role,
			tenant_id: input.tenant_id,
		},
	})
	return to_result<UserJson>(res, t('api.createFailed', { noun: tp('noun.user', 1) }))
}

export type UserUpdateInput = UserUpdate

export async function update_user(
	id: number,
	patch: UserUpdateInput,
): Promise<Result<UserJson, Error>> {
	const res = await client.users[':id'].$patch({
		param: { id: String(id) },
		json: patch,
	})
	return to_result<UserJson>(res, t('api.updateFailed', { noun: tp('noun.user', 1) }))
}

export async function delete_user(id: number): Promise<Result<unknown, Error>> {
	const res = await client.users[':id'].$delete({ param: { id: String(id) } })
	return to_result<unknown>(res, t('api.deleteFailed', { noun: tp('noun.user', 1) }))
}
