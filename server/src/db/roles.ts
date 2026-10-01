import { Result } from 'better-result'
import { and, asc, count, eq, inArray, isNull, ne, type SQL, sql } from 'drizzle-orm'
import {
	PERMISSIONS,
	type Permission,
	type RoleCreate,
	type RoleJson,
	type RoleUpdate,
} from 'shared/src/schemas'
import { role_permissions, roles, users } from '../schema'
import { getDb, withTransaction } from './connection'
import { ConflictError, DuplicateError, isUniqueViolation, NotFoundError } from './errors'
import {
	errOf,
	isPatchEmpty,
	type ListParams,
	offsetOf,
	type Page,
	pageOf,
	searchPattern,
} from './list'

// ---------------------------------------------------------------------------
// Roles: named permission bundles assigned to users (managed via
// `routes/roles.ts`, gated by `users.manage`). Invariants kept here and in
// `db/users.ts`:
// - `users.manage` holders are global (no tenant scope);
// - at least one global user keeps `users.manage` (no lockout);
// - a role in use cannot be deleted.
// ---------------------------------------------------------------------------

const NAME_IN_USE = 'Role name is already in use'

/** Permissions of a role in catalog order; unknown stored strings are dropped. */
export async function rolePermissions(roleId: number): Promise<Permission[]> {
	const rows = await getDb()
		.select({ permission: role_permissions.permission })
		.from(role_permissions)
		.where(eq(role_permissions.role_id, roleId))
	const granted = new Set(rows.map((r) => r.permission))
	return PERMISSIONS.filter((p) => granted.has(p))
}

async function userCount(roleId: number): Promise<number> {
	const row = (
		await getDb().select({ n: count() }).from(users).where(eq(users.role_id, roleId)).limit(1)
	)[0]
	return row?.n ?? 0
}

async function toRoleJson(row: typeof roles.$inferSelect): Promise<RoleJson> {
	return {
		id: row.id,
		name: row.name,
		description: row.description,
		permissions: await rolePermissions(row.id),
		user_count: await userCount(row.id),
	}
}

export async function listRoles(params: ListParams): Promise<Page<RoleJson>> {
	const db = getDb()
	const pattern = searchPattern(params.search)
	const where = params.search
		? sql`${roles.name} ILIKE ${pattern} ESCAPE '\\' OR ${roles.description} ILIKE ${pattern} ESCAPE '\\'`
		: undefined
	const rows = await db
		.select()
		.from(roles)
		.where(where)
		.orderBy(asc(roles.name), asc(roles.id))
		.limit(params.limit)
		.offset(offsetOf(params))
	const totalRow = (await db.select({ n: count() }).from(roles).where(where).limit(1))[0]
	const items = await Promise.all(rows.map(toRoleJson))
	return pageOf(items, totalRow?.n ?? 0, params)
}

export async function getRole(id: number): Promise<Result<RoleJson, Error>> {
	const row = (await getDb().select().from(roles).where(eq(roles.id, id)).limit(1))[0]
	if (!row) {
		return Result.err(new NotFoundError('Role not found'))
	}
	return Result.ok(await toRoleJson(row))
}

/**
 * Number of global users whose role grants `users.manage`. `excludeUserId`
 * leaves one user out (demotion/delete/re-scope checks); `excludeRoleId`
 * leaves a role out (that role is about to lose the permission).
 */
export async function countGlobalManagers(
	opts: { excludeUserId?: number; excludeRoleId?: number } = {},
): Promise<number> {
	const conditions: SQL[] = [
		isNull(users.tenant_id),
		eq(role_permissions.permission, 'users.manage'),
	]
	if (opts.excludeUserId !== undefined) {
		conditions.push(ne(users.id, opts.excludeUserId))
	}
	if (opts.excludeRoleId !== undefined) {
		conditions.push(ne(users.role_id, opts.excludeRoleId))
	}
	const row = (
		await getDb()
			.select({ n: count() })
			.from(users)
			.innerJoin(role_permissions, eq(role_permissions.role_id, users.role_id))
			.where(and(...conditions))
			.limit(1)
	)[0]
	return row?.n ?? 0
}

async function replacePermissions(roleId: number, permissions: Permission[]): Promise<void> {
	const db = getDb()
	await db.delete(role_permissions).where(eq(role_permissions.role_id, roleId))
	if (permissions.length > 0) {
		await db
			.insert(role_permissions)
			.values(permissions.map((permission) => ({ role_id: roleId, permission })))
	}
}

async function nameTaken(name: string, exceptId?: number): Promise<boolean> {
	const row = (
		await getDb().select({ id: roles.id }).from(roles).where(eq(roles.name, name)).limit(1)
	)[0]
	return row !== undefined && row.id !== exceptId
}

export async function createRole(input: RoleCreate): Promise<Result<RoleJson, Error>> {
	if (await nameTaken(input.name)) {
		return Result.err(new DuplicateError(NAME_IN_USE))
	}
	try {
		const id = await withTransaction(async () => {
			const inserted = (
				await getDb()
					.insert(roles)
					.values({ name: input.name, description: input.description ?? null })
					.returning({ id: roles.id })
			)[0]
			if (!inserted) {
				throw new Error('Role insert did not return an id')
			}
			await replacePermissions(inserted.id, input.permissions)
			return inserted.id
		})
		return await getRole(id)
	} catch (err) {
		if (isUniqueViolation(err)) {
			return Result.err(new DuplicateError(NAME_IN_USE))
		}
		return Result.err(errOf(err))
	}
}

export async function updateRole(id: number, input: RoleUpdate): Promise<Result<RoleJson, Error>> {
	const current = await getRole(id)
	if (Result.isError(current)) {
		return current
	}
	if (input.name !== undefined && (await nameTaken(input.name, id))) {
		return Result.err(new DuplicateError(NAME_IN_USE))
	}
	if (input.permissions !== undefined) {
		const grantsManage = input.permissions.includes('users.manage')
		if (grantsManage && !current.value.permissions.includes('users.manage')) {
			const scoped = (
				await getDb()
					.select({ id: users.id })
					.from(users)
					.where(and(eq(users.role_id, id), sql`${users.tenant_id} IS NOT NULL`))
					.limit(1)
			)[0]
			if (scoped) {
				return Result.err(
					new ConflictError(
						'Role is assigned to tenant-scoped users; users.manage requires global users',
					),
				)
			}
		}
		if (!grantsManage && (await countGlobalManagers({ excludeRoleId: id })) === 0) {
			return Result.err(
				new ConflictError('At least one global user must keep the users.manage permission'),
			)
		}
	}
	const patch: Partial<typeof roles.$inferInsert> = {}
	if (input.name !== undefined) {
		patch.name = input.name
	}
	if (input.description !== undefined) {
		patch.description = input.description
	}
	try {
		await withTransaction(async () => {
			if (!isPatchEmpty(patch)) {
				await getDb().update(roles).set(patch).where(eq(roles.id, id))
			}
			if (input.permissions !== undefined) {
				await replacePermissions(id, input.permissions)
			}
		})
	} catch (err) {
		if (isUniqueViolation(err)) {
			return Result.err(new DuplicateError(NAME_IN_USE))
		}
		return Result.err(errOf(err))
	}
	return await getRole(id)
}

export async function deleteRole(id: number): Promise<Result<RoleJson, Error>> {
	const current = await getRole(id)
	if (Result.isError(current)) {
		return current
	}
	if (current.value.user_count > 0) {
		return Result.err(new ConflictError('Role is still assigned to users; reassign them first'))
	}
	try {
		await getDb().delete(roles).where(eq(roles.id, id))
	} catch (e) {
		return Result.err(errOf(e))
	}
	return current
}

/** Existence guard for user writes: missing role is 404. */
export async function checkRoleExists(roleId: number): Promise<Result<undefined, Error>> {
	const row = (
		await getDb().select({ id: roles.id }).from(roles).where(eq(roles.id, roleId)).limit(1)
	)[0]
	return row ? Result.ok(undefined) : Result.err(new NotFoundError('Role not found'))
}

/**
 * Role for the first-run setup account: an existing role granting every
 * permission, otherwise a freshly created `Admin` role (`Admin (setup)`
 * when the name is taken).
 */
export async function fullAccessRoleId(): Promise<number> {
	const db = getDb()
	const rows = await db
		.select({ role_id: role_permissions.role_id, n: count() })
		.from(role_permissions)
		.where(inArray(role_permissions.permission, [...PERMISSIONS]))
		.groupBy(role_permissions.role_id)
		.orderBy(asc(role_permissions.role_id))
	const full = rows.find((r) => r.n === PERMISSIONS.length)
	if (full) {
		return full.role_id
	}
	const name = (await nameTaken('Admin')) ? 'Admin (setup)' : 'Admin'
	return await withTransaction(async () => {
		const inserted = (
			await getDb()
				.insert(roles)
				.values({ name, description: null })
				.returning({ id: roles.id })
		)[0]
		if (!inserted) {
			throw new Error('Role insert did not return an id')
		}
		await replacePermissions(inserted.id, [...PERMISSIONS])
		return inserted.id
	})
}
