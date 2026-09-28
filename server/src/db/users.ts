import { Result } from 'better-result'
import { and, asc, count, eq, gt, type SQL, sql } from 'drizzle-orm'
import type { Role, UserCreate, UserJson, UserUpdate } from 'shared/src/schemas'
import { auth_states, users } from '../schema'
import type { User } from '../types'
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
 * Direct local-user insert. Defaults to `admin` so first-run setup and the
 * pre-roles single-user installs keep full access; the `/users` route passes
 * an explicit role for every account it creates.
 */
export async function createLocalUser(
	username: string,
	passwordHash: string,
	role: Role = 'admin',
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
				role,
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
		role,
		tenant_id: tenantId,
	}
}

/** True when at least one user exists. Drives first-run setup gating. */
export async function hasAnyUser(): Promise<boolean> {
	const row = (await getDb().select({ id: users.id }).from(users).limit(1))[0]
	return row !== undefined && row !== null
}

// ---------------------------------------------------------------------------
// User management (admin-only via `routes/users.ts`)
// ---------------------------------------------------------------------------

export function toUserJson(row: User): UserJson {
	return { id: row.id, username: row.username, role: row.role, tenant_id: row.tenant_id }
}

export interface UserListParams extends ListParams {
	role?: Role
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
		conditions.push(eq(users.role, params.role))
	}
	if (params.tenant) {
		conditions.push(eq(users.tenant_id, params.tenant))
	}
	const where = conditions.length > 0 ? and(...conditions) : undefined
	const rows = (await db
		.select()
		.from(users)
		.where(where)
		.orderBy(asc(users.username))
		.limit(params.limit)
		.offset(offsetOf(params))) as User[]
	const totalRow = (await db.select({ n: count() }).from(users).where(where).limit(1))[0]
	return pageOf(rows.map(toUserJson), totalRow?.n ?? 0, params)
}

export async function getUserResult(id: number): Promise<Result<UserJson, Error>> {
	const row = await getUserById(id)
	if (!row) {
		return Result.err(new NotFoundError('User not found'))
	}
	return Result.ok(toUserJson(row))
}

/** Number of admin accounts, optionally excluding one user id. */
async function countAdmins(excludeId?: number): Promise<number> {
	const db = getDb()
	const where =
		excludeId === undefined
			? eq(users.role, 'admin')
			: and(eq(users.role, 'admin'), sql`${users.id} != ${excludeId}`)
	const row = (await db.select({ n: count() }).from(users).where(where).limit(1))[0]
	return row?.n ?? 0
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
	const role = input.role ?? 'viewer'
	if (role === 'admin' && input.tenant_id != null) {
		return Result.err(
			new ConflictError('Admin accounts are global and cannot be limited to a tenant'),
		)
	}
	try {
		const password_hash = await Bun.password.hash(input.password)
		const user = await createLocalUser(username, password_hash, role, input.tenant_id ?? null)
		return Result.ok(toUserJson(user))
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
	const effectiveRole = input.role ?? current.role
	const effectiveTenant = input.tenant_id !== undefined ? input.tenant_id : current.tenant_id
	if (effectiveRole === 'admin' && effectiveTenant !== null) {
		return Result.err(
			new ConflictError('Admin accounts are global and cannot be limited to a tenant'),
		)
	}
	if (current.role === 'admin' && effectiveRole !== 'admin' && (await countAdmins(id)) === 0) {
		return Result.err(new ConflictError('Cannot demote the last admin account'))
	}
	const patch: { role?: Role; tenant_id?: number | null; password_hash?: string } = {}
	if (input.role !== undefined) {
		patch.role = input.role
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
	const updated = await getUserById(id)
	if (!updated) {
		return Result.err(new NotFoundError('User not found'))
	}
	return Result.ok(toUserJson(updated))
}

export async function deleteUser(id: number, actorId: number): Promise<Result<UserJson, Error>> {
	const current = await getUserById(id)
	if (!current) {
		return Result.err(new NotFoundError('User not found'))
	}
	if (id === actorId) {
		return Result.err(new ConflictError('Cannot delete your own account'))
	}
	if (current.role === 'admin' && (await countAdmins(id)) === 0) {
		return Result.err(new ConflictError('Cannot delete the last admin account'))
	}
	try {
		await getDb().delete(users).where(eq(users.id, id))
	} catch (e) {
		return Result.err(errOf(e))
	}
	return Result.ok(toUserJson(current))
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
