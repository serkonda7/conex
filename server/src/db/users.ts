import { Result } from 'better-result'
import { and, asc, count, eq, inArray, type SQL, sql } from 'drizzle-orm'
import type { PasswordChange, UserCreate, UserJson, UserUpdate } from 'shared/src/schemas'
import { employee_tenants, employees, roles, tenants, user_tenants, users } from '../schema'
import type { User } from '../types'
import { normalize_username } from '../util/username'
import { getDb, withTransaction } from './connection'
import {
	ConflictError,
	DuplicateError,
	ForbiddenError,
	NotFoundError,
	ValidationError,
} from './errors'
import {
	findOne,
	isPatchEmpty,
	type ListParams,
	offsetOf,
	orderOf,
	type Page,
	pageOf,
	pickDefined,
	searchCondition,
	tryWrite,
} from './list'
import { checkRoleExists, countGlobalManagers, rolePermissions } from './roles'

export async function getUserByUsername(username: string): Promise<User | null> {
	return (await findOne(users, eq(users.username, normalize_username(username)))) ?? null
}

async function getUserById(id: number): Promise<User | null> {
	return (await findOne(users, eq(users.id, id))) ?? null
}

/** False when the account's employee is inactive: it may not sign in or keep sessions. */
export async function canSignIn(user: User): Promise<boolean> {
	if (user.employee_id === null) {
		return true
	}
	const employee = await findOne(employees, eq(employees.id, user.employee_id))
	return employee?.active === 1
}

/** The account's own `user_tenants`, by tenant id. */
async function ownTenantIds(userId: number): Promise<number[]> {
	const rows = await getDb()
		.select({ id: user_tenants.tenant_id })
		.from(user_tenants)
		.where(eq(user_tenants.user_id, userId))
		.orderBy(asc(user_tenants.tenant_id))
	return rows.map((row) => row.id)
}

/** Direct local-user insert (first-run setup and the `/users` route). */
export async function createLocalUser(
	username: string,
	passwordHash: string,
	roleId: number,
	employeeId: number | null = null,
): Promise<User> {
	const normalizedUsername = normalize_username(username)
	const inserted = (
		await getDb()
			.insert(users)
			.values({
				username: normalizedUsername,
				password_hash: passwordHash,
				provider: 'local',
				provider_id: null,
				role_id: roleId,
				employee_id: employeeId,
			})
			.returning({ id: users.id })
	)[0]
	if (!inserted) {
		throw new Error('User insert did not return an id')
	}
	return {
		id: inserted.id,
		username: normalizedUsername,
		password_hash: passwordHash,
		provider: 'local',
		provider_id: null,
		role_id: roleId,
		employee_id: employeeId,
	}
}

/** True when at least one user exists. Drives first-run setup gating. */
export async function hasAnyUser(): Promise<boolean> {
	const row = (await getDb().select({ id: users.id }).from(users).limit(1))[0]
	return row !== undefined && row !== null
}

// ---------------------------------------------------------------------------
// User management (`users.manage` via `routes/users.ts`)
// ---------------------------------------------------------------------------

/**
 * Tenant scope ids of the selected user (`authenticate` in `sessions.ts`
 * in SQL): the employee's memberships when linked, else its `user_tenants`.
 */
// jsonb, not an int array: Bun's driver returns int arrays as `Int32Array`.
// Qualified by hand: interpolated columns render unqualified in subqueries.
const userTenantIds: SQL<number[]> = sql<number[]>`coalesce(case
	when ${users}."employee_id" is not null then (
		select jsonb_agg("et"."tenant_id" order by "et"."position")
		from ${employee_tenants} as "et" where "et"."employee_id" = ${users}."employee_id"
	)
	else (
		select jsonb_agg("ut"."tenant_id" order by "ut"."tenant_id")
		from ${user_tenants} as "ut" where "ut"."user_id" = ${users}."id"
	)
end, '[]'::jsonb)`

/** Users whose scope includes `tenantId` (global users excluded). */
function userInTenant(tenantId: number): SQL {
	return sql`(exists (
		select 1 from ${employee_tenants} as "fe"
		where "fe"."employee_id" = ${users}."employee_id" and "fe"."tenant_id" = ${tenantId}
	) or exists (
		select 1 from ${user_tenants} as "fu"
		where "fu"."user_id" = ${users}."id" and "fu"."tenant_id" = ${tenantId}
	))`
}

/**
 * A user with its role, employee name and scope, as the management API
 * returns it (join `roles`, left join `employees`).
 */
const USER_JSON_COLUMNS: {
	id: typeof users.id
	username: typeof users.username
	role_id: typeof users.role_id
	role_name: typeof roles.name
	tenant_ids: SQL<number[]>
	employee_id: typeof users.employee_id
	employee_name: SQL<string | null>
	active: SQL<boolean>
} = {
	id: users.id,
	username: users.username,
	role_id: users.role_id,
	role_name: roles.name,
	tenant_ids: userTenantIds,
	employee_id: users.employee_id,
	employee_name: sql<string | null>`${employees.name}`,
	active: sql<boolean>`coalesce(${employees.active}, 1) = 1`,
}

/**
 * Users matching `where` (may use `employees` columns), by `orderBy` (may use
 * `roles` and `employees` columns too) and then username.
 */
function selectUserJson(
	where: SQL | undefined,
	limit: number,
	offset = 0,
	orderBy: SQL[] = [],
): Promise<UserJson[]> {
	return getDb()
		.select(USER_JSON_COLUMNS)
		.from(users)
		.innerJoin(roles, eq(roles.id, users.role_id))
		.leftJoin(employees, eq(employees.id, users.employee_id))
		.where(where)
		.orderBy(...orderBy, asc(users.username), asc(users.id))
		.limit(limit)
		.offset(offset)
}

async function getUserJson(id: number): Promise<UserJson | null> {
	return (await selectUserJson(eq(users.id, id), 1))[0] ?? null
}

/** True when the role grants `users.manage` (such users must be global). */
async function roleManagesUsers(roleId: number): Promise<boolean> {
	return (await rolePermissions(roleId)).includes('users.manage')
}

const USERNAME_IN_USE = 'Username is already in use'

const MANAGER_GLOBAL =
	'Users with the users.manage permission are global and cannot be limited to tenants'

const MANAGER_UNLINKED =
	'Users with the users.manage permission are global and cannot be linked to an employee, whose tenants would limit them'

const SCOPE_FOLLOWS_EMPLOYEE =
	"Accounts of employees are limited to the employee's tenants; change those on the employee instead"

export interface UserListParams extends ListParams {
	role?: number[]
	tenant?: number
	employee?: number
	sort: 'username' | 'employee' | 'role'
	order: 'asc' | 'desc'
}

export type UserPage = Page<UserJson>

export async function listUsers(params: UserListParams): Promise<UserPage> {
	const where = and(
		searchCondition(params.search, [users.username, employees.name]),
		params.role ? inArray(users.role_id, params.role) : undefined,
		params.tenant ? userInTenant(params.tenant) : undefined,
		params.employee ? eq(users.employee_id, params.employee) : undefined,
	)
	const orderColumn = {
		username: users.username,
		employee: employees.name,
		role: roles.name,
	}[params.sort]
	const rows = await selectUserJson(where, params.limit, offsetOf(params), [
		orderOf(orderColumn, params.order),
	])
	const [total] = await getDb()
		.select({ n: count() })
		.from(users)
		.leftJoin(employees, eq(employees.id, users.employee_id))
		.where(where)
	return pageOf(rows, total?.n ?? 0, params)
}

export async function getUserResult(id: number): Promise<Result<UserJson, Error>> {
	const row = await getUserJson(id)
	if (!row) {
		return Result.err(new NotFoundError('User not found'))
	}
	return Result.ok(row)
}

/** FK guards shared by user create/update. */
async function checkUserInput(input: {
	tenant_ids?: readonly number[]
	role_id?: number
}): Promise<Result<undefined, Error>> {
	const ids = input.tenant_ids ?? []
	if (
		ids.length > 0 &&
		(await getDb().$count(tenants, inArray(tenants.id, [...ids]))) !== ids.length
	) {
		return Result.err(new NotFoundError('Tenant not found'))
	}
	return input.role_id === undefined ? Result.ok(undefined) : checkRoleExists(input.role_id)
}

/**
 * Scope rules: user managers are global (no own tenants, no employee) and
 * employee-linked accounts take the employee's tenants (no own tenants).
 */
function checkScope(
	manages: boolean,
	employeeId: number | null,
	tenantIds: readonly number[],
): Result<undefined, Error> {
	if (manages && employeeId !== null) {
		return Result.err(new ConflictError(MANAGER_UNLINKED))
	}
	if (manages && tenantIds.length > 0) {
		return Result.err(new ConflictError(MANAGER_GLOBAL))
	}
	if (employeeId !== null && tenantIds.length > 0) {
		return Result.err(new ValidationError(SCOPE_FOLLOWS_EMPLOYEE))
	}
	return Result.ok(undefined)
}

/** Replaces the account's own tenants (`user_tenants`) with `tenantIds`. */
async function writeOwnTenants(userId: number, tenantIds: readonly number[]): Promise<void> {
	const db = getDb()
	await db.delete(user_tenants).where(eq(user_tenants.user_id, userId))
	if (tenantIds.length > 0) {
		await db
			.insert(user_tenants)
			.values(tenantIds.map((tenant_id) => ({ user_id: userId, tenant_id })))
	}
}

/** Login of an employee's account: its primary mail address, null without one. */
export function loginOf(emails: readonly { address: string }[]): string | null {
	const address = emails[0]?.address
	return address ? normalize_username(address) : null
}

/** `username` must not belong to another account (`userId` excluded). */
async function checkUsernameFree(
	username: string,
	userId?: number,
): Promise<Result<undefined, Error>> {
	const owner = await getUserByUsername(username)
	return owner && owner.id !== userId
		? Result.err(new DuplicateError(`${username} is already the username of another account`))
		: Result.ok(undefined)
}

const NO_LOGIN_MAIL = 'The employee needs a mail address to sign in with; add one first'

/**
 * Employee link rule: an employee has at most one account (`userId`
 * excluded). Returns the employee's login (`loginOf`), null without employee.
 */
async function checkEmployeeLink(
	employeeId: number | null,
	userId?: number,
): Promise<Result<string | null, Error>> {
	if (employeeId === null) {
		return Result.ok(null)
	}
	const employee = await findOne(employees, eq(employees.id, employeeId))
	if (!employee) {
		return Result.err(new NotFoundError('Employee not found'))
	}
	const owner = await findOne(users, eq(users.employee_id, employeeId))
	if (owner && owner.id !== userId) {
		return Result.err(new DuplicateError(EMPLOYEE_IN_USE))
	}
	return Result.ok(loginOf(employee.emails))
}

/**
 * Login change of employee `employeeId`'s account when its mail addresses
 * change from `before` to `after`: the account follows the primary address.
 * The address in use cannot be removed, a new one must be free, and only
 * user managers (`mayChange`) move the login. Null when the login stays.
 */
export async function nextLogin(
	employeeId: number,
	before: readonly { address: string }[],
	after: readonly { address: string }[],
	mayChange: boolean,
): Promise<Result<{ userId: number; username: string } | null, Error>> {
	const account = await findOne(users, eq(users.employee_id, employeeId))
	if (!account) {
		return Result.ok(null)
	}
	const has = (list: readonly { address: string }[]): boolean =>
		list.some((e) => normalize_username(e.address) === account.username)
	if (has(before) && !has(after)) {
		return Result.err(
			new ConflictError(
				`${account.username} is used to sign in and cannot be removed; move another address to the top and save first`,
			),
		)
	}
	const next = loginOf(after)
	if (next === null || next === account.username) {
		return Result.ok(null)
	}
	if (!mayChange) {
		return Result.err(
			new ForbiddenError(
				'Only user managers can change the primary mail address, which the employee signs in with',
			),
		)
	}
	const free = await checkUsernameFree(next, account.id)
	if (Result.isError(free)) {
		return free
	}
	return Result.ok({ userId: account.id, username: next })
}

const EMPLOYEE_IN_USE = 'Employee already has a user account'

/** Unique violations on create/update: username or employee taken. */
function duplicateOf(err: unknown): Error {
	return new DuplicateError(
		String(err).includes('employee_id') ? EMPLOYEE_IN_USE : USERNAME_IN_USE,
	)
}

/** Accounts of employees sign in with the employee's primary mail address (`loginOf`). */
export async function createUser(input: UserCreate): Promise<Result<UserJson, Error>> {
	const valid = await checkUserInput(input)
	if (Result.isError(valid)) {
		return valid
	}
	const employeeId = input.employee_id ?? null
	const scope = checkScope(await roleManagesUsers(input.role_id), employeeId, input.tenant_ids)
	if (Result.isError(scope)) {
		return scope
	}
	const link = await checkEmployeeLink(employeeId)
	if (Result.isError(link)) {
		return link
	}
	if (employeeId !== null && link.value === null) {
		return Result.err(new ValidationError(NO_LOGIN_MAIL))
	}
	const username = link.value ?? normalize_username(input.username ?? '')
	if (!username) {
		return Result.err(
			new ValidationError('A username is required for accounts without employee'),
		)
	}
	const free = await checkUsernameFree(username)
	if (Result.isError(free)) {
		return free
	}
	const passwordHash = await Bun.password.hash(input.password)
	const user = await tryWrite(
		() =>
			withTransaction(async () => {
				const created = await createLocalUser(
					username,
					passwordHash,
					input.role_id,
					employeeId,
				)
				await writeOwnTenants(created.id, input.tenant_ids)
				return created
			}),
		duplicateOf,
	)
	if (Result.isError(user)) {
		return user
	}
	return await getUserResult(user.value.id)
}

export async function updateUser(id: number, input: UserUpdate): Promise<Result<UserJson, Error>> {
	const current = await getUserById(id)
	if (!current) {
		return Result.err(new NotFoundError('User not found'))
	}
	const valid = await checkUserInput(input)
	if (Result.isError(valid)) {
		return valid
	}
	const effectiveRole = input.role_id ?? current.role_id
	const effectiveEmployee =
		input.employee_id !== undefined ? input.employee_id : current.employee_id
	// Linking an employee drops the account's own tenants.
	const effectiveTenants =
		input.tenant_ids ?? (effectiveEmployee === null ? await ownTenantIds(id) : [])
	const willManage = await roleManagesUsers(effectiveRole)
	const scope = checkScope(willManage, effectiveEmployee, effectiveTenants)
	if (Result.isError(scope)) {
		return scope
	}
	const link = await checkEmployeeLink(effectiveEmployee, id)
	if (Result.isError(link)) {
		return link
	}
	// A newly linked employee needs a mail address; accounts linked before
	// usernames followed the mail address keep theirs until it gets one.
	if (effectiveEmployee !== current.employee_id && effectiveEmployee !== null && !link.value) {
		return Result.err(new ValidationError(NO_LOGIN_MAIL))
	}
	const username = link.value !== null && link.value !== current.username ? link.value : undefined
	if (username !== undefined) {
		const free = await checkUsernameFree(username, id)
		if (Result.isError(free)) {
			return free
		}
	}
	if (
		!willManage &&
		(await roleManagesUsers(current.role_id)) &&
		(await countGlobalManagers({ excludeUserId: id })) === 0
	) {
		return Result.err(
			new ConflictError('At least one global user must keep the users.manage permission'),
		)
	}
	const patch: Partial<User> = {
		...pickDefined(input, ['role_id', 'employee_id']),
		...(username !== undefined ? { username } : {}),
	}
	if (input.password !== undefined) {
		patch.password_hash = await Bun.password.hash(input.password)
	}
	const written = await tryWrite(
		() =>
			withTransaction(async () => {
				if (!isPatchEmpty(patch)) {
					await getDb().update(users).set(patch).where(eq(users.id, id))
				}
				await writeOwnTenants(id, effectiveTenants)
			}),
		duplicateOf,
	)
	if (Result.isError(written)) {
		return written
	}
	return await getUserResult(id)
}

export async function deleteUser(id: number, actorId: number): Promise<Result<UserJson, Error>> {
	const current = await getUserJson(id)
	if (!current) {
		return Result.err(new NotFoundError('User not found'))
	}
	if (id === actorId) {
		return Result.err(new ConflictError('Cannot delete your own account'))
	}
	if (
		(await roleManagesUsers(current.role_id)) &&
		(await countGlobalManagers({ excludeUserId: id })) === 0
	) {
		return Result.err(new ConflictError('Cannot delete the last user able to manage users'))
	}
	const deleted = await tryWrite(() => getDb().delete(users).where(eq(users.id, id)))
	if (Result.isError(deleted)) {
		return deleted
	}
	return Result.ok(current)
}

/** Replaces `id`'s password after re-checking the current one. */
export async function changeOwnPassword(
	id: number,
	input: PasswordChange,
): Promise<Result<undefined, Error>> {
	const current = await getUserById(id)
	if (!current) {
		return Result.err(new NotFoundError('User not found'))
	}
	if (
		!current.password_hash ||
		!(await Bun.password.verify(input.current_password, current.password_hash))
	) {
		return Result.err(new ValidationError('Current password is incorrect'))
	}
	const written = await tryWrite(async () => {
		await getDb()
			.update(users)
			.set({ password_hash: await Bun.password.hash(input.new_password) })
			.where(eq(users.id, id))
	})
	return written.map(() => undefined)
}
