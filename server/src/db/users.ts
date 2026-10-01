import { Result } from 'better-result'
import { and, asc, count, eq, gt, type SQL, sql } from 'drizzle-orm'
import type { UserCreate, UserJson, UserUpdate } from 'shared/src/schemas'
import { auth_states, roles, users } from '../schema'
import type { CurrentUser, User } from '../types'
import { normalize_username } from '../util/username'
import { getDb } from './connection'
import { ConflictError, DuplicateError, isUniqueViolation, NotFoundError } from './errors'
import {
	checkTenantExists,
	errOf,
	isPatchEmpty,
	type ListParams,
	offsetOf,
	type Page,
	pageOf,
	searchPattern,
} from './list'
import { checkRoleExists, countGlobalManagers, rolePermissions } from './roles'

export async function getUserByUsername(username: string): Promise<User | null> {
	const normalized = normalize_username(username)
	const row = (
		await getDb().select().from(users).where(eq(users.username, normalized)).limit(1)
	)[0]
	return (row as User | null) ?? null
}

export async function getUserById(id: number): Promise<User | null> {
	const row = (await getDb().select().from(users).where(eq(users.id, id)).limit(1))[0]
	return (row as User | null) ?? null
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
	const role = (await getDb().select().from(roles).where(eq(roles.id, user.role_id)).limit(1))[0]
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

async function getUserJson(id: number): Promise<UserJson | null> {
	const row = (
		await getDb()
			.select({
				id: users.id,
				username: users.username,
				role_id: users.role_id,
				role_name: roles.name,
				tenant_id: users.tenant_id,
			})
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

const MANAGER_GLOBAL =
	'Users with the users.manage permission are global and cannot be limited to a tenant'

export interface UserListParams extends ListParams {
	role?: number
	tenant?: number
}

export type UserPage = Page<UserJson>

export async function listUsers(params: UserListParams): Promise<UserPage> {
	const db = getDb()
	const pattern = searchPattern(params.search)
	const conditions: SQL[] = []
	if (params.search) {
		conditions.push(sql`${users.username} ILIKE ${pattern} ESCAPE '\\'`)
	}
	if (params.role) {
		conditions.push(eq(users.role_id, params.role))
	}
	if (params.tenant) {
		conditions.push(eq(users.tenant_id, params.tenant))
	}
	const where = conditions.length > 0 ? and(...conditions) : undefined
	const rows = await db
		.select({
			id: users.id,
			username: users.username,
			role_id: users.role_id,
			role_name: roles.name,
			tenant_id: users.tenant_id,
		})
		.from(users)
		.innerJoin(roles, eq(roles.id, users.role_id))
		.where(where)
		.orderBy(asc(users.username))
		.limit(params.limit)
		.offset(offsetOf(params))
	const totalRow = (await db.select({ n: count() }).from(users).where(where).limit(1))[0]
	return pageOf(rows, totalRow?.n ?? 0, params)
}

export async function getUserResult(id: number): Promise<Result<UserJson, Error>> {
	const row = await getUserJson(id)
	if (!row) {
		return Result.err(new NotFoundError('User not found'))
	}
	return Result.ok(row)
}

export async function createUser(input: UserCreate): Promise<Result<UserJson, Error>> {
	const username = normalize_username(input.username)
	if (!username) {
		return Result.err(new ConflictError('Username and password are required.'))
	}
	if (await getUserByUsername(username)) {
		return Result.err(new DuplicateError('Username is already in use'))
	}
	const tenantCheck = await checkTenantExists(input.tenant_id)
	if (Result.isError(tenantCheck)) {
		return Result.err(tenantCheck.error)
	}
	const roleCheck = await checkRoleExists(input.role_id)
	if (Result.isError(roleCheck)) {
		return Result.err(roleCheck.error)
	}
	if (input.tenant_id != null && (await roleManagesUsers(input.role_id))) {
		return Result.err(new ConflictError(MANAGER_GLOBAL))
	}
	try {
		const password_hash = await Bun.password.hash(input.password)
		const user = await createLocalUser(
			username,
			password_hash,
			input.role_id,
			input.tenant_id ?? null,
		)
		return await getUserResult(user.id)
	} catch (err) {
		if (isUniqueViolation(err)) {
			return Result.err(new DuplicateError('Username is already in use'))
		}
		return Result.err(err instanceof Error ? err : new Error(String(err)))
	}
}

export async function updateUser(id: number, input: UserUpdate): Promise<Result<UserJson, Error>> {
	const current = await getUserById(id)
	if (!current) {
		return Result.err(new NotFoundError('User not found'))
	}
	if (input.tenant_id !== undefined) {
		const tenantCheck = await checkTenantExists(input.tenant_id)
		if (Result.isError(tenantCheck)) {
			return Result.err(tenantCheck.error)
		}
	}
	if (input.role_id !== undefined) {
		const roleCheck = await checkRoleExists(input.role_id)
		if (Result.isError(roleCheck)) {
			return Result.err(roleCheck.error)
		}
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
	const patch: { role_id?: number; tenant_id?: number | null; password_hash?: string } = {}
	if (input.role_id !== undefined) {
		patch.role_id = input.role_id
	}
	if (input.tenant_id !== undefined) {
		patch.tenant_id = input.tenant_id
	}
	if (input.password !== undefined) {
		try {
			patch.password_hash = await Bun.password.hash(input.password)
		} catch (err) {
			return Result.err(err instanceof Error ? err : new Error(String(err)))
		}
	}
	if (!isPatchEmpty(patch)) {
		try {
			await getDb().update(users).set(patch).where(eq(users.id, id))
		} catch (err) {
			return Result.err(err instanceof Error ? err : new Error(String(err)))
		}
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
	try {
		await getDb().delete(users).where(eq(users.id, id))
	} catch (e) {
		return Result.err(errOf(e))
	}
	return Result.ok(current)
}

// ---------------------------------------------------------------------------
// OAuth-style login states (kept for the session sweep; consumed by future
// external providers, if any).
// ---------------------------------------------------------------------------

export async function createAuthState(
	state: string,
	verifier: string,
	expiresAt: number,
): Promise<void> {
	await getDb().insert(auth_states).values({ state, verifier, expires_at: expiresAt })
}

export interface ConsumedAuthState {
	verifier: string
}

/**
 * Atomically consumes a state: deletes the row only when it exists
 * and has not expired, returning its verifier.
 *
 * Returns `null` when the state is missing or expired. Expired rows are
 * removed as a side effect so failed callbacks do not accumulate.
 */
export async function consumeAuthState(
	state: string,
	now: number,
): Promise<ConsumedAuthState | null> {
	const consumed = (
		await getDb()
			.delete(auth_states)
			.where(and(eq(auth_states.state, state), gt(auth_states.expires_at, now)))
			.returning({ verifier: auth_states.verifier })
	)[0]
	if (consumed) {
		return consumed
	}
	// Missing or expired: drop an expired leftover if present, then report miss.
	await getDb().delete(auth_states).where(eq(auth_states.state, state))
	return null
}
