import { Result } from 'better-result'
import { and, asc, eq, getTableColumns, inArray, notInArray, type SQL, sql } from 'drizzle-orm'
import type { EmployeeCreate, EmployeeListQuery, EmployeeUpdate } from 'shared/src/schemas'
import {
	devices,
	employee_tenants,
	employees,
	external_links,
	role_permissions,
	tenants,
	users,
	virtual_machines,
} from '../schema'
import { logCreate, logDelete, logUpdate } from './changelog'
import { getDb, withTransaction } from './connection'
import { ConflictError, DuplicateError, NotFoundError } from './errors'
import {
	findOne,
	insertedId,
	isPatchEmpty,
	type ListParams,
	offsetOf,
	orderOf,
	type Page,
	pageOf,
	pickDefined,
	searchCondition,
	type TenantFilterParams,
	tenantConditions,
	tryWrite,
} from './list'
import { countGlobalManagers } from './roles'
import { nextLogin } from './users'

/**
 * Employee with its tenants in membership order (first = primary) and the
 * username of its account (`login`, its primary mail address), if any.
 */
export type EmployeeRow = typeof employees.$inferSelect & {
	tenant_ids: number[]
	login: string | null
}

/** Tenant ids of the selected employee, in membership order. */
// jsonb, not an int array: Bun's driver returns int arrays as `Int32Array`.
export const employeeTenantIds: SQL<number[]> = sql<number[]>`coalesce((
	select jsonb_agg(${employee_tenants.tenant_id} order by ${employee_tenants.position})
	from ${employee_tenants}
	where ${employee_tenants.employee_id} = ${employees.id}
), '[]'::jsonb)`

/** Username of the selected employee's account, null without one. */
// Qualified by hand: interpolated columns render unqualified, and `id` would bind to `users`.
const employeeLogin: SQL<string | null> = sql<string | null>`(
	select "u"."username" from ${users} as "u" where "u"."employee_id" = ${employees}."id"
)`

/** Columns of an `EmployeeRow`. */
const employeeColumns: ReturnType<typeof getTableColumns<typeof employees>> & {
	tenant_ids: SQL<number[]>
	login: SQL<string | null>
} = { ...getTableColumns(employees), tenant_ids: employeeTenantIds, login: employeeLogin }

/**
 * Employees with a membership matching all `conditions` (on
 * `employee_tenants` columns); `undefined` when there are none.
 */
export function memberCondition(conditions: SQL[]): SQL | undefined {
	if (conditions.length === 0) {
		return undefined
	}
	return sql`exists (select 1 from ${employee_tenants} where ${employee_tenants.employee_id} = ${employees.id} and ${and(...conditions)})`
}

/** Employees belonging to `tenantId`. */
export function memberOf(tenantId: number): SQL | undefined {
	return memberCondition([eq(employee_tenants.tenant_id, tenantId)])
}

/** Device and VM assignments cannot expose or link contacts from another tenant. */
export async function checkEmployeeAssignment(
	employeeId: number | null | undefined,
	tenantId: number | null | undefined,
): Promise<Result<undefined, Error>> {
	if (employeeId === null || employeeId === undefined) {
		return Result.ok(undefined)
	}
	if (tenantId === null || tenantId === undefined) {
		return Result.err(new ConflictError('Select a tenant before assigning an employee'))
	}
	const membership = await findOne(
		employee_tenants,
		and(eq(employee_tenants.employee_id, employeeId), eq(employee_tenants.tenant_id, tenantId)),
	)
	return membership
		? Result.ok(undefined)
		: Result.err(new NotFoundError('Employee not found in this tenant'))
}

// ---------------------------------------------------------------------------
// Employees: contact persons of tenants. Integrations link them to external
// contacts (`external_links`, entity type `employee`).
// ---------------------------------------------------------------------------

export interface EmployeeListParams extends ListParams, TenantFilterParams {
	active?: boolean
	sort: EmployeeListQuery['sort']
	order: 'asc' | 'desc'
}

export async function listEmployees(params: EmployeeListParams): Promise<Page<EmployeeRow>> {
	const where = and(
		searchCondition(params.search, [
			employees.name,
			employees.title,
			sql`jsonb_path_query_array(${employees.emails}, '$[*].address')::text`,
			sql`jsonb_path_query_array(${employees.phones}, '$[*].number')::text`,
		]),
		params.active !== undefined ? eq(employees.active, params.active ? 1 : 0) : undefined,
		memberCondition(tenantConditions(employee_tenants.tenant_id, params)),
	)
	const orderColumn = {
		name: employees.name,
		first_name: employees.first_name,
		last_name: employees.last_name,
		salutation: employees.salutation,
		title: employees.title,
		// Primary (first) address.
		email: sql`${employees.emails}->0->>'address'`,
		// Active first.
		status: sql`-${employees.active}`,
		description: employees.description,
	}[params.sort]
	const db = getDb()
	const items = await db
		.select(employeeColumns)
		.from(employees)
		.where(where)
		.orderBy(orderOf(orderColumn, params.order), asc(employees.name), asc(employees.id))
		.limit(params.limit)
		.offset(offsetOf(params))
	return pageOf(items, await db.$count(employees, where), params)
}

export async function getEmployee(id: number): Promise<Result<EmployeeRow, Error>> {
	const [row] = await getDb()
		.select(employeeColumns)
		.from(employees)
		.where(eq(employees.id, id))
		.limit(1)
	return row ? Result.ok(row) : Result.err(new NotFoundError('Employee not found'))
}

/** Every id in `tenantIds` must name an existing tenant. */
async function checkTenantsExist(tenantIds: readonly number[]): Promise<Result<undefined, Error>> {
	const found = await getDb().$count(tenants, inArray(tenants.id, [...tenantIds]))
	return found === new Set(tenantIds).size
		? Result.ok(undefined)
		: Result.err(new NotFoundError('Tenant not found'))
}

/**
 * Sets the memberships of an employee to `tenantIds`, in order. Kept
 * memberships are updated in place, so assignments referencing them stay valid.
 */
async function writeMemberships(employeeId: number, tenantIds: readonly number[]): Promise<void> {
	const db = getDb()
	await db
		.delete(employee_tenants)
		.where(
			and(
				eq(employee_tenants.employee_id, employeeId),
				notInArray(employee_tenants.tenant_id, [...tenantIds]),
			),
		)
	await db
		.insert(employee_tenants)
		.values(
			tenantIds.map((tenant_id, position) => ({
				employee_id: employeeId,
				tenant_id,
				position,
			})),
		)
		.onConflictDoUpdate({
			target: [employee_tenants.employee_id, employee_tenants.tenant_id],
			set: { position: sql`excluded.position` },
		})
}

export async function createEmployee(input: EmployeeCreate): Promise<Result<EmployeeRow, Error>> {
	const tenant = await checkTenantsExist(input.tenant_ids)
	if (Result.isError(tenant)) {
		return tenant
	}
	// `name` is generated from first + last name.
	const row: Omit<typeof employees.$inferInsert, 'id'> = {
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
	const id = await tryWrite(() =>
		withTransaction(async () => {
			const created = insertedId(
				await getDb().insert(employees).values(row).returning({ id: employees.id }),
			)
			await writeMemberships(created, input.tenant_ids)
			return created
		}),
	)
	if (Result.isError(id)) {
		return id
	}
	return await logCreate('employee', await getEmployee(id.value))
}

/**
 * The account of an employee signs in with its primary mail address, which
 * follows the mail list (see `nextLogin`); only user managers
 * (`mayChangeLogin`) change it.
 */
export async function updateEmployee(
	id: number,
	input: EmployeeUpdate,
	opts: { mayChangeLogin: boolean },
): Promise<Result<EmployeeRow, Error>> {
	const current = await getEmployee(id)
	if (Result.isError(current)) {
		return current
	}
	const login =
		input.emails === undefined
			? Result.ok(null)
			: await nextLogin(id, current.value.emails, input.emails, opts.mayChangeLogin)
	if (Result.isError(login)) {
		return login
	}
	const tenantIds = input.tenant_ids
	if (tenantIds !== undefined) {
		const tenant = await checkTenantsExist(tenantIds)
		if (Result.isError(tenant)) {
			return tenant
		}
		const removed = current.value.tenant_ids.filter((t) => !tenantIds.includes(t))
		if (removed.length > 0 && (await hasAssignments(id, removed))) {
			return Result.err(
				new ConflictError(
					'Employee still has assigned devices or virtual machines in a removed tenant; unassign them first',
				),
			)
		}
	}
	if (input.active === false && current.value.active === 1 && (await isLastManager(id))) {
		return Result.err(
			new ConflictError(
				'The employee has the last account able to manage users; it cannot be deactivated',
			),
		)
	}
	const patch = {
		...pickDefined(input, [
			'first_name',
			'last_name',
			'salutation',
			'title',
			'emails',
			'phones',
			'description',
			'comments',
		]),
		...(input.active !== undefined ? { active: input.active ? 1 : 0 } : {}),
	}
	const membershipsChanged =
		tenantIds !== undefined &&
		JSON.stringify(tenantIds) !== JSON.stringify(current.value.tenant_ids)
	const nextAccount = login.value
	if (!isPatchEmpty(patch) || membershipsChanged) {
		const written = await tryWrite(
			() =>
				withTransaction(async () => {
					if (!isPatchEmpty(patch)) {
						await getDb().update(employees).set(patch).where(eq(employees.id, id))
					}
					if (membershipsChanged) {
						await writeMemberships(id, tenantIds)
					}
					if (nextAccount) {
						await getDb()
							.update(users)
							.set({ username: nextAccount.username })
							.where(eq(users.id, nextAccount.userId))
					}
				}),
			() =>
				new DuplicateError(
					`${nextAccount?.username ?? 'The address'} is already the username of another account`,
				),
		)
		if (Result.isError(written)) {
			return written
		}
	}
	return await logUpdate('employee', current.value, await getEmployee(id))
}

/** Whether a device or virtual machine is assigned to the employee (in one of `tenantIds`). */
async function hasAssignments(id: number, tenantIds?: number[]): Promise<boolean> {
	return (
		(await findOne(
			devices,
			and(
				eq(devices.employee_id, id),
				tenantIds ? inArray(devices.tenant_id, tenantIds) : undefined,
			),
		)) !== undefined ||
		(await findOne(
			virtual_machines,
			and(
				eq(virtual_machines.employee_id, id),
				tenantIds ? inArray(virtual_machines.tenant_id, tenantIds) : undefined,
			),
		)) !== undefined
	)
}

/** Whether the employee's account is the last global one able to manage users. */
async function isLastManager(id: number): Promise<boolean> {
	const [account] = await getDb()
		.select({ id: users.id })
		.from(users)
		.innerJoin(role_permissions, eq(role_permissions.role_id, users.role_id))
		.where(and(eq(users.employee_id, id), eq(role_permissions.permission, 'users.manage')))
		.limit(1)
	return account !== undefined && (await countGlobalManagers({ excludeUserId: account.id })) === 0
}

export async function deleteEmployee(id: number): Promise<Result<EmployeeRow, Error>> {
	const current = await getEmployee(id)
	if (Result.isError(current)) {
		return current
	}
	if (await findOne(users, eq(users.employee_id, id))) {
		return Result.err(new ConflictError('Employee still has a user account; delete it first'))
	}
	if (await hasAssignments(id)) {
		return Result.err(
			new ConflictError(
				'Employee still has assigned devices or virtual machines; unassign them first',
			),
		)
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
