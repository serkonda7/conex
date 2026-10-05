import { Result } from 'better-result'
import { and, asc, count, eq, inArray, isNotNull, isNull, ne, type SQL } from 'drizzle-orm'
import {
	PERMISSIONS,
	type Permission,
	type RoleCreate,
	type RoleJson,
	type RoleUpdate,
} from 'shared/src/schemas'
import { role_permissions, roles, users } from '../schema'
import { getDb, withTransaction } from './connection'
import { ConflictError, DuplicateError } from './errors'
import {
	checkExists,
	exists,
	findById,
	insertedId,
	isPatchEmpty,
	isTaken,
	type ListParams,
	type Page,
	pageRows,
	pickDefined,
	searchCondition,
	tryWrite,
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

function userCount(roleId: number): Promise<number> {
	return getDb().$count(users, eq(users.role_id, roleId))
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
	const page = await pageRows(
		roles,
		searchCondition(params.search, [roles.name, roles.description]),
		[asc(roles.name), asc(roles.id)],
		params,
	)
	return { ...page, items: await Promise.all(page.items.map(toRoleJson)) }
}

export async function getRole(id: number): Promise<Result<RoleJson, Error>> {
	const row = await findById(roles, id, 'Role not found')
	return Result.isOk(row) ? Result.ok(await toRoleJson(row.value)) : row
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

function nameTaken(name: string, exceptId?: number): Promise<boolean> {
	return isTaken(roles, eq(roles.name, name), exceptId)
}

/** Inserts a role with its permissions in one transaction; returns its id. */
function insertRole(
	name: string,
	description: string | null,
	permissions: Permission[],
): Promise<number> {
	return withTransaction(async () => {
		const id = insertedId(
			await getDb().insert(roles).values({ name, description }).returning({ id: roles.id }),
		)
		await replacePermissions(id, permissions)
		return id
	})
}

export async function createRole(input: RoleCreate): Promise<Result<RoleJson, Error>> {
	if (await nameTaken(input.name)) {
		return Result.err(new DuplicateError(NAME_IN_USE))
	}
	const id = await tryWrite(
		() => insertRole(input.name, input.description ?? null, input.permissions),
		NAME_IN_USE,
	)
	if (Result.isError(id)) {
		return id
	}
	return await getRole(id.value)
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
		if (
			grantsManage &&
			!current.value.permissions.includes('users.manage') &&
			(await exists(users, and(eq(users.role_id, id), isNotNull(users.tenant_id))))
		) {
			return Result.err(
				new ConflictError(
					'Role is assigned to tenant-scoped users; users.manage requires global users',
				),
			)
		}
		if (!grantsManage && (await countGlobalManagers({ excludeRoleId: id })) === 0) {
			return Result.err(
				new ConflictError('At least one global user must keep the users.manage permission'),
			)
		}
	}
	const patch = pickDefined(input, ['name', 'description'])
	const written = await tryWrite(
		() =>
			withTransaction(async () => {
				if (!isPatchEmpty(patch)) {
					await getDb().update(roles).set(patch).where(eq(roles.id, id))
				}
				if (input.permissions !== undefined) {
					await replacePermissions(id, input.permissions)
				}
			}),
		NAME_IN_USE,
	)
	if (Result.isError(written)) {
		return written
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
	const deleted = await tryWrite(() => getDb().delete(roles).where(eq(roles.id, id)))
	if (Result.isError(deleted)) {
		return deleted
	}
	return current
}

/** Existence guard for user writes: missing role is 404. */
export function checkRoleExists(roleId: number): Promise<Result<undefined, Error>> {
	return checkExists(roles, roleId, 'Role not found')
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
	return await insertRole(name, null, [...PERMISSIONS])
}
