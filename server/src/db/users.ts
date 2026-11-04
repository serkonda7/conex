import { Result } from 'better-result'
import { and, asc, count, eq, type SQL, sql } from 'drizzle-orm'
import type { PasswordChange, UserCreate, UserJson, UserUpdate } from 'shared/src/schemas'
import { employee_tenants, employees, roles, users } from '../schema'
import type { CurrentUser, User } from '../types'
import { normalize_username } from '../util/username'
import { getDb } from './connection'
import {
	ConflictError,
	DuplicateError,
	ForbiddenError,
	NotFoundError,
	ValidationError,
} from './errors'
import {
	checkTenantExists,
	findOne,
	isPatchEmpty,
	type ListParams,
	offsetOf,
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

/**
 * Requester identity for `authMiddleware`: the user row plus its role's
 * name and permissions, read live so role edits apply immediately.
 */
export async function getCurrentUser(username: string): Promise<CurrentUser | null> {
	const user = await getUserByUsername(username)
	if (!user || !(await canSignIn(user))) {
		return null
	}
	const role = await findOne(roles, eq(roles.id, user.role_id))
	return {
		id: user.id,
		username: user.username,
		role_id: user.role_id,
		role_name: role?.name ?? '',
		permissions: new Set(await rolePermissions(user.role_id)),
		tenant_id: user.tenant_id,
		employee_id: user.employee_id,
	}
}

/** Direct local-user insert (first-run setup and the `/users` route). */
export async function createLocalUser(
	username: string,
	passwordHash: string,
	roleId: number,
	tenantId: number | null = null,
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
				tenant_id: tenantId,
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
		tenant_id: tenantId,
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
 * A user with its role and employee name, as the management API returns it
 * (join `roles`, left join `employees`).
 */
const USER_JSON_COLUMNS: {
	id: typeof users.id
	username: typeof users.username
	role_id: typeof users.role_id
	role_name: typeof roles.name
	tenant_id: typeof users.tenant_id
	employee_id: typeof users.employee_id
	employee_name: SQL<string | null>
	active: SQL<boolean>
} = {
	id: users.id,
	username: users.username,
	role_id: users.role_id,
	role_name: roles.name,
	tenant_id: users.tenant_id,
	employee_id: users.employee_id,
	employee_name: sql<string | null>`${employees.name}`,
	active: sql<boolean>`coalesce(${employees.active}, 1) = 1`,
}

/** Users matching `where` (may use `employees` columns), by username. */
function selectUserJson(where: SQL | undefined, limit: number, offset = 0): Promise<UserJson[]> {
	return getDb()
		.select(USER_JSON_COLUMNS)
		.from(users)
		.innerJoin(roles, eq(roles.id, users.role_id))
		.leftJoin(employees, eq(employees.id, users.employee_id))
		.where(where)
		.orderBy(asc(users.username))
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
	'Users with the users.manage permission are global and cannot be limited to a tenant'

export interface UserListParams extends ListParams {
	role?: number
	tenant?: number
	employee?: number
}

export type UserPage = Page<UserJson>

export async function listUsers(params: UserListParams): Promise<UserPage> {
	const where = and(
		searchCondition(params.search, [users.username, employees.name]),
		params.role ? eq(users.role_id, params.role) : undefined,
		params.tenant ? eq(users.tenant_id, params.tenant) : undefined,
		params.employee ? eq(users.employee_id, params.employee) : undefined,
	)
	const rows = await selectUserJson(where, params.limit, offsetOf(params))
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
	tenant_id?: number | null
	role_id?: number
}): Promise<Result<undefined, Error>> {
	const tenantCheck = await checkTenantExists(input.tenant_id)
	if (Result.isError(tenantCheck) || input.role_id === undefined) {
		return tenantCheck
	}
	return checkRoleExists(input.role_id)
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
 * Employee link rules: a scoped account belongs to an employee of that
 * tenant, and an employee has at most one account (`userId` excluded).
 * Returns the employee's login (`loginOf`), null without employee.
 */
async function checkEmployeeLink(
	employeeId: number | null,
	tenantId: number | null,
	userId?: number,
): Promise<Result<string | null, Error>> {
	if (employeeId === null) {
		return tenantId === null
			? Result.ok(null)
			: Result.err(new ValidationError('Tenant-scoped users must be linked to an employee'))
	}
	const employee = await findOne(employees, eq(employees.id, employeeId))
	if (!employee) {
		return Result.err(new NotFoundError('Employee not found'))
	}
	const owner = await findOne(users, eq(users.employee_id, employeeId))
	if (owner && owner.id !== userId) {
		return Result.err(new DuplicateError(EMPLOYEE_IN_USE))
	}
	if (
		tenantId !== null &&
		!(await findOne(
			employee_tenants,
			and(
				eq(employee_tenants.employee_id, employeeId),
				eq(employee_tenants.tenant_id, tenantId),
			),
		))
	) {
		return Result.err(
			new ConflictError("The tenant scope must be one of the employee's tenants"),
		)
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
	if (input.tenant_id != null && (await roleManagesUsers(input.role_id))) {
		return Result.err(new ConflictError(MANAGER_GLOBAL))
	}
	const employeeId = input.employee_id ?? null
	const link = await checkEmployeeLink(employeeId, input.tenant_id ?? null)
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
	const user = await tryWrite(
		async () =>
			createLocalUser(
				username,
				await Bun.password.hash(input.password),
				input.role_id,
				input.tenant_id ?? null,
				employeeId,
			),
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
	const effectiveTenant = input.tenant_id !== undefined ? input.tenant_id : current.tenant_id
	const effectiveEmployee =
		input.employee_id !== undefined ? input.employee_id : current.employee_id
	const willManage = await roleManagesUsers(effectiveRole)
	if (willManage && effectiveTenant !== null) {
		return Result.err(new ConflictError(MANAGER_GLOBAL))
	}
	const link = await checkEmployeeLink(effectiveEmployee, effectiveTenant, id)
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
	// Linking a manager to an inactive employee locks the account out too.
	const keepsManaging =
		willManage && (await canSignIn({ ...current, employee_id: effectiveEmployee }))
	if (
		!keepsManaging &&
		(await roleManagesUsers(current.role_id)) &&
		(await countGlobalManagers({ excludeUserId: id })) === 0
	) {
		return Result.err(
			new ConflictError('At least one global user must keep the users.manage permission'),
		)
	}
	const written = await tryWrite(async () => {
		const patch: Partial<User> = {
			...pickDefined(input, ['role_id', 'tenant_id', 'employee_id']),
			...(username !== undefined ? { username } : {}),
		}
		if (input.password !== undefined) {
			patch.password_hash = await Bun.password.hash(input.password)
		}
		if (!isPatchEmpty(patch)) {
			await getDb().update(users).set(patch).where(eq(users.id, id))
		}
	}, duplicateOf)
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
