import { Result } from 'better-result'
import { and, asc, eq } from 'drizzle-orm'
import type { PasswordChange, UserCreate, UserJson, UserUpdate } from 'shared/src/schemas'
import { roles, users } from '../schema'
import type { CurrentUser, User } from '../types'
import { normalize_username } from '../util/username'
import { getDb } from './connection'
import { ConflictError, DuplicateError, NotFoundError, ValidationError } from './errors'
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

/**
 * Requester identity for `authMiddleware`: the user row plus its role's
 * name and permissions, read live so role edits apply immediately.
 */
export async function getCurrentUser(username: string): Promise<CurrentUser | null> {
	const user = await getUserByUsername(username)
	if (!user) {
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
	}
}

/** Direct local-user insert (first-run setup and the `/users` route). */
export async function createLocalUser(
	username: string,
	passwordHash: string,
	roleId: number,
	tenantId: number | null = null,
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

/** A user with its role name, as the management API returns it (join `roles`). */
const USER_JSON_COLUMNS: {
	id: typeof users.id
	username: typeof users.username
	role_id: typeof users.role_id
	role_name: typeof roles.name
	tenant_id: typeof users.tenant_id
} = {
	id: users.id,
	username: users.username,
	role_id: users.role_id,
	role_name: roles.name,
	tenant_id: users.tenant_id,
}

async function getUserJson(id: number): Promise<UserJson | null> {
	const row = (
		await getDb()
			.select(USER_JSON_COLUMNS)
			.from(users)
			.innerJoin(roles, eq(roles.id, users.role_id))
			.where(eq(users.id, id))
			.limit(1)
	)[0]
	return row ?? null
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
}

export type UserPage = Page<UserJson>

export async function listUsers(params: UserListParams): Promise<UserPage> {
	const where = and(
		searchCondition(params.search, [users.username]),
		params.role ? eq(users.role_id, params.role) : undefined,
		params.tenant ? eq(users.tenant_id, params.tenant) : undefined,
	)
	const rows = await getDb()
		.select(USER_JSON_COLUMNS)
		.from(users)
		.innerJoin(roles, eq(roles.id, users.role_id))
		.where(where)
		.orderBy(asc(users.username))
		.limit(params.limit)
		.offset(offsetOf(params))
	return pageOf(rows, await getDb().$count(users, where), params)
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

export async function createUser(input: UserCreate): Promise<Result<UserJson, Error>> {
	const username = normalize_username(input.username)
	if (!username) {
		return Result.err(new ConflictError('Username and password are required.'))
	}
	if (await getUserByUsername(username)) {
		return Result.err(new DuplicateError(USERNAME_IN_USE))
	}
	const valid = await checkUserInput(input)
	if (Result.isError(valid)) {
		return valid
	}
	if (input.tenant_id != null && (await roleManagesUsers(input.role_id))) {
		return Result.err(new ConflictError(MANAGER_GLOBAL))
	}
	const user = await tryWrite(
		async () =>
			createLocalUser(
				username,
				await Bun.password.hash(input.password),
				input.role_id,
				input.tenant_id ?? null,
			),
		USERNAME_IN_USE,
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
	const willManage = await roleManagesUsers(effectiveRole)
	if (willManage && effectiveTenant !== null) {
		return Result.err(new ConflictError(MANAGER_GLOBAL))
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
	const written = await tryWrite(async () => {
		const patch: Partial<User> = pickDefined(input, ['role_id', 'tenant_id'])
		if (input.password !== undefined) {
			patch.password_hash = await Bun.password.hash(input.password)
		}
		if (!isPatchEmpty(patch)) {
			await getDb().update(users).set(patch).where(eq(users.id, id))
		}
	})
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
