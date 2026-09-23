/**
 * Users API wrappers: admin-only account management over the hono RPC
 * client. Errors surface as `Result.err` with the server's `{ error }`
 * message, matching the other API modules.
 */
import type { Result } from 'better-result'
import type { Page, UserJson } from 'shared/src/types'
import { client, to_query, to_result } from './api'

export type { UserJson }
export type UserRole = UserJson['role']

export interface UserFilters {
	search?: string
	page?: number
	limit?: number
	role?: UserRole
	tenant?: number
}

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
	return to_result<Page<UserJson>>(res, 'Failed to load users')
}

export async function fetch_user(id: number): Promise<Result<UserJson, Error>> {
	const res = await client.users[':id'].$get({ param: { id: String(id) } })
	return to_result<UserJson>(res, 'Failed to load user')
}

export interface UserCreateInput {
	username: string
	password: string
	role: UserRole
	tenant_id: number | null
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
	return to_result<UserJson>(res, 'Failed to create user')
}

export interface UserUpdateInput {
	role?: UserRole
	tenant_id?: number | null
	password?: string
}

export async function update_user(
	id: number,
	patch: UserUpdateInput,
): Promise<Result<UserJson, Error>> {
	const res = await client.users[':id'].$patch({
		param: { id: String(id) },
		json: patch,
	})
	return to_result<UserJson>(res, 'Failed to update user')
}

export async function delete_user(id: number): Promise<Result<unknown, Error>> {
	const res = await client.users[':id'].$delete({ param: { id: String(id) } })
	return to_result<unknown>(res, 'Failed to delete user')
}
