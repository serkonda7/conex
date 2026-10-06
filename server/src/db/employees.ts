import { Result } from 'better-result'
import { and, asc, eq, sql } from 'drizzle-orm'
import type { EmployeeCreate, EmployeeUpdate } from 'shared/src/schemas'
import { employees, external_links } from '../schema'
import { logCreate, logDelete, logUpdate } from './changelog'
import { getDb } from './connection'
import {
	checkTenantExists,
	findById,
	insertedId,
	isPatchEmpty,
	type ListParams,
	orderOf,
	type Page,
	pageRows,
	pickDefined,
	searchCondition,
	type TenantFilterParams,
	tenantConditions,
	tryWrite,
} from './list'

export type EmployeeRow = typeof employees.$inferSelect

// ---------------------------------------------------------------------------
// Employees: contact persons of a tenant. Integrations link them to external
// contacts (`external_links`, entity type `employee`).
// ---------------------------------------------------------------------------

export interface EmployeeListParams extends ListParams, TenantFilterParams {
	active?: boolean
	sort: 'name' | 'first_name' | 'last_name' | 'title' | 'email'
	order: 'asc' | 'desc'
}

export function listEmployees(params: EmployeeListParams): Promise<Page<EmployeeRow>> {
	const where = and(
		searchCondition(params.search, [
			employees.name,
			employees.title,
			sql`jsonb_path_query_array(${employees.emails}, '$[*].address')::text`,
			sql`jsonb_path_query_array(${employees.phones}, '$[*].number')::text`,
		]),
		params.active !== undefined ? eq(employees.active, params.active ? 1 : 0) : undefined,
		...tenantConditions(employees.tenant_id, params),
	)
	const orderColumn = {
		name: employees.name,
		first_name: employees.first_name,
		last_name: employees.last_name,
		title: employees.title,
		// Primary (first) address.
		email: sql`${employees.emails}->0->>'address'`,
	}[params.sort]
	return pageRows(
		employees,
		where,
		[orderOf(orderColumn, params.order), asc(employees.name), asc(employees.id)],
		params,
	)
}

export function getEmployee(id: number): Promise<Result<EmployeeRow, Error>> {
	return findById(employees, id, 'Employee not found')
}

export async function createEmployee(input: EmployeeCreate): Promise<Result<EmployeeRow, Error>> {
	const tenant = await checkTenantExists(input.tenant_id)
	if (Result.isError(tenant)) {
		return tenant
	}
	// `name` is generated from first + last name.
	const row: Omit<typeof employees.$inferInsert, 'id'> = {
		tenant_id: input.tenant_id,
		first_name: input.first_name ?? null,
		last_name: input.last_name,
		salutation: input.salutation ?? null,
		title: input.title ?? null,
		emails: input.emails,
		phones: input.phones,
		active: input.active ? 1 : 0,
		description: input.description ?? null,
		comments: input.comments ?? null,
	}
	const id = await tryWrite(async () =>
		insertedId(await getDb().insert(employees).values(row).returning({ id: employees.id })),
	)
	if (Result.isError(id)) {
		return id
	}
	return await logCreate('employee', await getEmployee(id.value))
}

export async function updateEmployee(
	id: number,
	input: EmployeeUpdate,
): Promise<Result<EmployeeRow, Error>> {
	const current = await getEmployee(id)
	if (Result.isError(current)) {
		return current
	}
	const tenant = await checkTenantExists(input.tenant_id)
	if (Result.isError(tenant)) {
		return tenant
	}
	const patch = {
		...pickDefined(input, [
			'first_name',
			'last_name',
			'salutation',
			'tenant_id',
			'title',
			'emails',
			'phones',
			'description',
			'comments',
		]),
		...(input.active !== undefined ? { active: input.active ? 1 : 0 } : {}),
	}
	if (!isPatchEmpty(patch)) {
		const written = await tryWrite(() =>
			getDb().update(employees).set(patch).where(eq(employees.id, id)),
		)
		if (Result.isError(written)) {
			return written
		}
	}
	return await logUpdate('employee', current.value, await getEmployee(id))
}

export async function deleteEmployee(id: number): Promise<Result<EmployeeRow, Error>> {
	const current = await getEmployee(id)
	if (Result.isError(current)) {
		return current
	}
	const deleted = await tryWrite(() =>
		getDb().transaction(async (tx) => {
			await tx
				.delete(external_links)
				.where(
					and(
						eq(external_links.entity_type, 'employee'),
						eq(external_links.entity_id, id),
					),
				)
			await tx.delete(employees).where(eq(employees.id, id))
		}),
	)
	if (Result.isError(deleted)) {
		return deleted
	}
	return await logDelete('employee', current.value)
}
