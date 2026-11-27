import { Result } from 'better-result'
import { and, eq, gt, isNull, lte, ne, or, sql } from 'drizzle-orm'
import { sign } from 'hono/jwt'
import type { CookieOptions } from 'hono/utils/cookie'
import { PERMISSIONS, type Permission, type RoleJson } from 'shared/src/schemas'
import {
	SESSION_ABSOLUTE_TIMEOUT_S,
	SESSION_IDLE_TIMEOUT_S,
	SESSION_TOUCH_INTERVAL_S,
} from 'shared/src/session'
import { getConfig } from './config'
import { pruneAuditLog } from './db/audit'
import { pruneChangelog } from './db/changelog'
import { getDb } from './db/connection'
import { type ViewAsOwner, viewAsRole } from './db/roles'
import { getSigningKey } from './keys'
import { JWT_ALGO, type JwtPayload } from './middleware/auth'
import {
	auth_states,
	employee_tenants,
	employees,
	role_permissions,
	roles,
	sessions,
	user_tenants,
	users,
} from './schema'
import type { CurrentUser, User } from './types'
import { nowSeconds } from './util/time'
import { normalize_username } from './util/username'

export function getSessionCookieOpts(): CookieOptions {
	return {
		httpOnly: true,
		secure: getConfig().auth.secureCookies,
		sameSite: 'Strict',
		path: '/',
		maxAge: SESSION_ABSOLUTE_TIMEOUT_S,
	}
}

export const SESSION_SWEEP_INTERVAL_MS = 60 * 60 * 1000

async function createSession(userId: number): Promise<string> {
	// Opaque v7 token (not an entity id): time-ordered, so recent sessions
	// sort without a secondary index.
	const id = Bun.randomUUIDv7()
	const now = nowSeconds()
	await getDb()
		.insert(sessions)
		.values({
			id,
			user_id: userId,
			created_at: now,
			last_seen_at: now,
			expires_at: now + SESSION_ABSOLUTE_TIMEOUT_S,
		})
	return id
}

/** Oldest `last_seen_at` of a live session (idle timeout plus touch slack). */
function idleCutoff(now: number): number {
	return now - (SESSION_IDLE_TIMEOUT_S + SESSION_TOUCH_INTERVAL_S)
}

/**
 * Requester identity for `authMiddleware` in one statement: validates the
 * session (live, owned by `sub`, employee active), refreshes its idle window
 * at most every `SESSION_TOUCH_INTERVAL_S`, and loads the role name,
 * permissions and tenant scope live, so role and membership edits apply on
 * the next request. Null when any check fails; invalid sessions are left to
 * `sweepExpired`. A session viewing the app as another role gets that role's
 * permissions (`viewedRole`).
 *
 * Tenant scope: the employee's tenants in membership order (`[]` when none)
 * for employee-linked accounts, else the account's `user_tenants`, where
 * none (`jsonb_agg` over no rows) = null = global.
 */
export async function authenticate(sid: string, sub: string): Promise<CurrentUser | null> {
	const db = getDb()
	const now = nowSeconds()
	const live = and(
		eq(sessions.id, sid),
		gt(sessions.expires_at, now),
		gt(sessions.last_seen_at, idleCutoff(now)),
	)
	const session = db
		.$with('s')
		.as(
			db
				.select({ user_id: sessions.user_id, view_as_role_id: sessions.view_as_role_id })
				.from(sessions)
				.where(live),
		)
	// Runs although unreferenced; matches no row (and writes nothing) while
	// `last_seen_at` is recent.
	const touch = db.$with('touch').as(
		db
			.update(sessions)
			.set({ last_seen_at: now })
			.where(and(live, lte(sessions.last_seen_at, now - SESSION_TOUCH_INTERVAL_S)))
			.returning({ id: sessions.id }),
	)
	// jsonb, not arrays: Bun's driver may return int arrays as `Int32Array`.
	const permissions = db
		.select({ list: sql`jsonb_agg(${role_permissions.permission})` })
		.from(role_permissions)
		.where(eq(role_permissions.role_id, users.role_id))
	const employeeScope = db
		.select({
			list: sql`jsonb_agg(${employee_tenants.tenant_id} order by ${employee_tenants.position})`,
		})
		.from(employee_tenants)
		.where(eq(employee_tenants.employee_id, users.employee_id))
	const ownScope = db
		.select({
			list: sql`jsonb_agg(${user_tenants.tenant_id} order by ${user_tenants.tenant_id})`,
		})
		.from(user_tenants)
		.where(eq(user_tenants.user_id, users.id))
	const rows = await db
		.with(session, touch)
		.select({
			id: users.id,
			username: users.username,
			role_id: users.role_id,
			role_name: roles.name,
			employee_id: users.employee_id,
			view_as_role_id: session.view_as_role_id,
			permissions: sql<string[]>`coalesce((${permissions}), '[]'::jsonb)`,
			tenant_ids: sql<number[] | null>`case when ${users.employee_id} is not null
				then coalesce((${employeeScope}), '[]'::jsonb) else (${ownScope}) end`,
		})
		.from(session)
		.innerJoin(users, eq(users.id, session.user_id))
		.innerJoin(roles, eq(roles.id, users.role_id))
		.leftJoin(employees, eq(employees.id, users.employee_id))
		.where(
			and(
				eq(users.username, normalize_username(sub)),
				or(isNull(users.employee_id), eq(employees.active, 1)),
			),
		)
	const row = rows[0]
	if (!row) {
		return null
	}
	// Catalog order; unknown stored strings are dropped (as `rolePermissions`).
	const granted = new Set(row.permissions)
	const own: ReadonlySet<Permission> = new Set(PERMISSIONS.filter((p) => granted.has(p)))
	const viewed =
		row.view_as_role_id === null
			? null
			: await viewedRole({ role_id: row.role_id, permissions: own }, row.view_as_role_id)
	return {
		id: row.id,
		username: row.username,
		role_id: row.role_id,
		role_name: row.role_name,
		permissions: viewed ? new Set(viewed.permissions) : own,
		own_permissions: own,
		view_as: viewed ? { role_id: viewed.id, role_name: viewed.name } : null,
		tenant_ids: row.tenant_ids,
		employee_id: row.employee_id,
	}
}

/**
 * The role a session views the app as, re-checked per request: when the
 * user's role changed so that it is no longer offered (`canViewAs`), the
 * session falls back to the own role.
 */
async function viewedRole(owner: ViewAsOwner, roleId: number): Promise<RoleJson | null> {
	const role = await viewAsRole(owner, roleId)
	return Result.isOk(role) ? role.value : null
}

/**
 * Lets session `sid` view the app as role `roleId` (null = own role again).
 * 404 for a missing role, 403 for one `owner` may not view as.
 */
export async function setSessionViewAs(
	sid: string,
	owner: ViewAsOwner,
	roleId: number | null,
): Promise<Result<undefined, Error>> {
	if (roleId !== null) {
		const role = await viewAsRole(owner, roleId)
		if (Result.isError(role)) {
			return role
		}
	}
	await getDb().update(sessions).set({ view_as_role_id: roleId }).where(eq(sessions.id, sid))
	return Result.ok(undefined)
}

export async function invalidateSession(sid: string): Promise<void> {
	await getDb().delete(sessions).where(eq(sessions.id, sid))
}

/** Ends every session of `userId` except `keepSid` (after a password change). */
export async function invalidateUserSessions(userId: number, keepSid?: string): Promise<void> {
	await getDb()
		.delete(sessions)
		.where(and(eq(sessions.user_id, userId), keepSid ? ne(sessions.id, keepSid) : undefined))
}

/**
 * Removes expired sessions and PKCE states in one scheduled sweep, plus
 * audit log and changelog entries past their retention.
 */
export async function sweepExpired(): Promise<number> {
	const now = nowSeconds()
	const expiredSessions = or(
		lte(sessions.expires_at, now),
		lte(sessions.last_seen_at, idleCutoff(now)),
	)
	const removed = await getDb().transaction(async (tx) => {
		const sessionsRemoved = (
			await tx.delete(sessions).where(expiredSessions).returning({ id: sessions.id })
		).length
		const statesRemoved = (
			await tx
				.delete(auth_states)
				.where(lte(auth_states.expires_at, now))
				.returning({ state: auth_states.state })
		).length
		return sessionsRemoved + statesRemoved
	})
	const auditRemoved = await pruneAuditLog(now)
	const changesRemoved = await pruneChangelog(now)
	return removed + auditRemoved + changesRemoved
}

export async function get_signed_jwt(user: User): Promise<string> {
	const now = nowSeconds()
	const sid = await createSession(user.id)
	const payload: JwtPayload = {
		sub: user.username,
		jti: sid,
		iat: now,
		exp: now + SESSION_ABSOLUTE_TIMEOUT_S,
	}
	return await sign(payload, getSigningKey(), JWT_ALGO)
}
