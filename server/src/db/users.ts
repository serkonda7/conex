import { Result } from 'better-result'
import { and, asc, count, eq, gt, type SQL, sql } from 'drizzle-orm'
import type { Role, UserCreate, UserJson, UserUpdate } from 'shared/src/schemas'
import { auth_states, tenants, users } from '../schema'
import type { User } from '../types'
import { normalize_username } from '../util/username'
import { getDb } from './connection'
import { ConflictError, DuplicateError, isUniqueViolation, NotFoundError } from './errors'

export function getUserByUsername(username: string): User | null {
	const normalized = normalize_username(username)
	const row = getDb().select().from(users).where(eq(users.username, normalized)).get()
	return (row as User | null) ?? null
}

export function getUserById(id: number): User | null {
	const row = getDb().select().from(users).where(eq(users.id, id)).get()
	return (row as User | null) ?? null
}

/**
 * Direct local-user insert. Defaults to `admin` so first-run setup and the
 * pre-roles single-user installs keep full access; the `/users` route passes
 * an explicit role for every account it creates.
 */
export function createLocalUser(
	username: string,
	passwordHash: string,
	role: Role = 'admin',
	tenantId: number | null = null,
): User {
	const normalizedUsername = normalize_username(username)
	const inserted = getDb()
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
		.get()
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
export function hasAnyUser(): boolean {
	const row = getDb().select({ id: users.id }).from(users).limit(1).get()
	return row !== undefined && row !== null
}

// ---------------------------------------------------------------------------
// User management (admin-only via `routes/users.ts`)
// ---------------------------------------------------------------------------

/** LIKE pattern with `%`, `_` and `\` escaped so the search stays literal. */
function searchPattern(raw: string): string {
	return `%${raw.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')}%`
}

export function toUserJson(row: User): UserJson {
	return { id: row.id, username: row.username, role: row.role, tenant_id: row.tenant_id }
}

export interface UserListParams {
	search: string
	page: number
	limit: number
	role?: Role
	tenant?: number
}

export interface UserPage {
	items: UserJson[]
	total: number
	page: number
	limit: number
}

export function listUsers(params: UserListParams): UserPage {
	const db = getDb()
	const pattern = searchPattern(params.search)
	const conditions: SQL[] = []
	if (params.search) {
		conditions.push(sql`${users.username} LIKE ${pattern} ESCAPE '\\'`)
	}
	if (params.role) {
		conditions.push(eq(users.role, params.role))
	}
	if (params.tenant) {
		conditions.push(eq(users.tenant_id, params.tenant))
	}
	const where = conditions.length > 0 ? and(...conditions) : undefined
	const rows = db
		.select()
		.from(users)
		.where(where)
		.orderBy(asc(users.username))
		.limit(params.limit)
		.offset((params.page - 1) * params.limit)
		.all() as User[]
	const totalRow = db.select({ n: count() }).from(users).where(where).get()
	return {
		items: rows.map(toUserJson),
		total: totalRow?.n ?? 0,
		page: params.page,
		limit: params.limit,
	}
}

export function getUserResult(id: number): Result<UserJson, Error> {
	const row = getUserById(id)
	if (!row) {
		return Result.err(new NotFoundError('User not found'))
	}
	return Result.ok(toUserJson(row))
}

function checkTenantRef(tenantId: number | null | undefined): Error | null {
	if (tenantId === null || tenantId === undefined) {
		return null
	}
	const tenant = getDb().select().from(tenants).where(eq(tenants.id, tenantId)).get()
	return tenant ? null : new NotFoundError('Tenant not found')
}

/** Number of admin accounts, optionally excluding one user id. */
function countAdmins(excludeId?: number): number {
	const db = getDb()
	const where =
		excludeId === undefined
			? eq(users.role, 'admin')
			: and(eq(users.role, 'admin'), sql`${users.id} != ${excludeId}`)
	const row = db.select({ n: count() }).from(users).where(where).get()
	return row?.n ?? 0
}

export async function createUser(input: UserCreate): Promise<Result<UserJson, Error>> {
	const username = normalize_username(input.username)
	if (!username) {
		return Result.err(new ConflictError('Username and password are required.'))
	}
	if (getUserByUsername(username)) {
		return Result.err(new DuplicateError('Username is already in use'))
	}
	const tenantErr = checkTenantRef(input.tenant_id)
	if (tenantErr) {
		return Result.err(tenantErr)
	}
	const role = input.role ?? 'viewer'
	if (role === 'admin' && input.tenant_id != null) {
		return Result.err(
			new ConflictError('Admin accounts are global and cannot be limited to a tenant'),
		)
	}
	try {
		const password_hash = await Bun.password.hash(input.password)
		const user = createLocalUser(username, password_hash, role, input.tenant_id ?? null)
		return Result.ok(toUserJson(user))
	} catch (err) {
		if (isUniqueViolation(err)) {
			return Result.err(new DuplicateError('Username is already in use'))
		}
		return Result.err(err instanceof Error ? err : new Error(String(err)))
	}
}

export async function updateUser(id: number, input: UserUpdate): Promise<Result<UserJson, Error>> {
	const current = getUserById(id)
	if (!current) {
		return Result.err(new NotFoundError('User not found'))
	}
	if (input.tenant_id !== undefined) {
		const tenantErr = checkTenantRef(input.tenant_id)
		if (tenantErr) {
			return Result.err(tenantErr)
		}
	}
	const effectiveRole = input.role ?? current.role
	const effectiveTenant = input.tenant_id !== undefined ? input.tenant_id : current.tenant_id
	if (effectiveRole === 'admin' && effectiveTenant !== null) {
		return Result.err(
			new ConflictError('Admin accounts are global and cannot be limited to a tenant'),
		)
	}
	if (current.role === 'admin' && effectiveRole !== 'admin' && countAdmins(id) === 0) {
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
	if (Object.keys(patch).length > 0) {
		try {
			getDb().update(users).set(patch).where(eq(users.id, id)).run()
		} catch (err) {
			return Result.err(err instanceof Error ? err : new Error(String(err)))
		}
	}
	const updated = getUserById(id)
	if (!updated) {
		return Result.err(new NotFoundError('User not found'))
	}
	return Result.ok(toUserJson(updated))
}

export function deleteUser(id: number, actorId: number): Result<UserJson, Error> {
	const current = getUserById(id)
	if (!current) {
		return Result.err(new NotFoundError('User not found'))
	}
	if (id === actorId) {
		return Result.err(new ConflictError('Cannot delete your own account'))
	}
	if (current.role === 'admin' && countAdmins(id) === 0) {
		return Result.err(new ConflictError('Cannot delete the last admin account'))
	}
	getDb().delete(users).where(eq(users.id, id)).run()
	return Result.ok(toUserJson(current))
}

// ---------------------------------------------------------------------------
// OAuth-style login states (kept for the session sweep; consumed by future
// external providers, if any).
// ---------------------------------------------------------------------------

export function createAuthState(state: string, verifier: string, expiresAt: number): void {
	getDb().insert(auth_states).values({ state, verifier, expires_at: expiresAt }).run()
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
export function consumeAuthState(state: string, now: number): ConsumedAuthState | null {
	const consumed = getDb()
		.delete(auth_states)
		.where(and(eq(auth_states.state, state), gt(auth_states.expires_at, now)))
		.returning({ verifier: auth_states.verifier })
		.get()
	if (consumed) {
		return consumed
	}
	// Missing or expired: drop an expired leftover if present, then report miss.
	getDb().delete(auth_states).where(eq(auth_states.state, state)).run()
	return null
}
