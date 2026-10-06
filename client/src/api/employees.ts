/**
 * Employees API wrappers: typed calls for the contact persons of tenants
 * over the hono RPC client. Errors surface as `Result.err` with the server's
 * `{ error }` message.
 */
import type { Result } from 'better-result'
import type { EmployeeRow } from 'server/src/db/employees'
import type { EmployeeCreate, EmployeeListQuery, EmployeeUpdate, Page } from 'shared/src/types'
import { by_id, client, failed, getPage, paging, to_query, to_result } from './client'

export type { EmployeeRow }

export type EmployeeSort = EmployeeListQuery['sort']

export async function fetch_employees(
	filters?: Partial<EmployeeListQuery>,
): Promise<Result<Page<EmployeeRow>, Error>> {
	return getPage<EmployeeRow>(
		client.employees.$get({
			query: to_query({
				...paging(filters),
				tenant: filters?.tenant,
				tenant_group: filters?.tenant_group,
				active: filters?.active,
				sort: filters?.sort ?? 'last_name',
				order: filters?.order ?? 'asc',
			}),
		}),
		failed.list('noun.employee'),
	)
}

export async function fetch_employee(id: number): Promise<Result<EmployeeRow, Error>> {
	const res = await client.employees[':id'].$get(by_id(id))
	return to_result<EmployeeRow>(res, failed.load('noun.employee'))
}

export async function create_employee(input: EmployeeCreate): Promise<Result<EmployeeRow, Error>> {
	const res = await client.employees.$post({ json: input })
	return to_result<EmployeeRow>(res, failed.create('noun.employee'))
}

export async function update_employee(
	id: number,
	patch: EmployeeUpdate,
): Promise<Result<EmployeeRow, Error>> {
	const res = await client.employees[':id'].$patch({ ...by_id(id), json: patch })
	return to_result<EmployeeRow>(res, failed.update('noun.employee'))
}

export async function delete_employee(id: number): Promise<Result<unknown, Error>> {
	const res = await client.employees[':id'].$delete(by_id(id))
	return to_result<unknown>(res, failed.delete('noun.employee'))
}
