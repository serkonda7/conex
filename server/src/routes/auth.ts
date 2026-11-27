import { vValidator } from '@hono/valibot-validator'
import { Result } from 'better-result'
import { type Context, Hono } from 'hono'
import { deleteCookie, setCookie } from 'hono/cookie'
import {
	LoginSchema,
	PasswordChangeSchema,
	type SessionUser,
	SetupSchema,
	ViewAsSchema,
} from 'shared/src/schemas'
import { requestUser } from '../authz'
import { isUniqueViolation } from '../db/errors'
import { fullAccessRoleId, listViewAsRoles, type ViewAsOwner } from '../db/roles'
import {
	canSignIn,
	changeOwnPassword,
	createLocalUser,
	getUserByUsername,
	hasAnyUser,
} from '../db/users'
import { authMiddleware } from '../middleware/auth'
import { rate_limit } from '../middleware/rate_limit'
import { onValidationError } from '../middleware/validation'
import {
	authenticate,
	get_signed_jwt,
	getSessionCookieOpts,
	invalidateSession,
	invalidateUserSessions,
	setSessionViewAs,
} from '../sessions'
import type { CurrentUser, User } from '../types'
import { auditRequest } from '../util/audit'
import { peer_ip } from '../util/client_ip'
import { jsonError } from '../util/http'
import { sendResult } from '../util/result_response'
import { normalize_username } from '../util/username'

export const authApp = new Hono()

const AUTH_COOKIE = 'auth_token'

/** Opens a session for `user` and sets its cookie. */
async function startSession(c: Context, user: User): Promise<void> {
	setCookie(c, AUTH_COOKIE, await get_signed_jwt(user), getSessionCookieOpts())
}

// ---------------------------------------------------------------------------
// Providers capability endpoint (local auth only in v1)
// ---------------------------------------------------------------------------

authApp.get('/providers', (c) => {
	return c.json({
		local: true,
		microsoft: false,
	})
})

// ---------------------------------------------------------------------------
// First-run setup: the admin account is created through the UI, not a CLI.
// `GET /setup-status` is public so the login page can swap in the setup
// dialog; `POST /setup` only succeeds while the users table is empty.
// ---------------------------------------------------------------------------

authApp.get('/setup-status', async (c) => {
	return c.json({ needsSetup: !(await hasAnyUser()) })
})

authApp.post(
	'/setup',
	rate_limit(),
	vValidator('json', SetupSchema, onValidationError),
	async (c) => {
		if (await hasAnyUser()) {
			return jsonError(c, 'Setup already completed', 409)
		}

		const body = c.req.valid('json')
		const username = normalize_username(body.username)
		if (!username) {
			return jsonError(c, 'Username and password are required.', 400)
		}

		if (await getUserByUsername(username)) {
			return jsonError(c, 'Setup already completed', 409)
		}

		try {
			const password_hash = await Bun.password.hash(body.password)
			// First account owns the instance: a global role with every permission.
			const user = await createLocalUser(username, password_hash, await fullAccessRoleId())
			await startSession(c, user)
			return c.json({ success: true }, 201)
		} catch (error: unknown) {
			if (isUniqueViolation(error)) {
				return jsonError(c, 'Setup already completed', 409)
			}
			return jsonError(c, 'Failed to create admin account', 500)
		}
	},
)

authApp.post(
	'/login',
	rate_limit(),
	vValidator('json', LoginSchema, onValidationError),
	async (c) => {
		const body = c.req.valid('json')
		// Read the peer before the slow password check: Bun no longer knows the
		// address once the client has dropped the connection.
		const ip = peer_ip(c)

		const user = await getUserByUsername(body.username)
		if (!user?.password_hash) {
			await auditRequest(
				c,
				{ event: 'login.failure', username: body.username, user_id: user?.id ?? null },
				ip,
			)
			return jsonError(c, 'Invalid username or password', 401)
		}

		// Accounts of inactive employees fail like a wrong password.
		const isMatch =
			(await Bun.password.verify(body.password, user.password_hash)) &&
			(await canSignIn(user))
		if (!isMatch) {
			await auditRequest(
				c,
				{ event: 'login.failure', username: user.username, user_id: user.id },
				ip,
			)
			return jsonError(c, 'Invalid username or password', 401)
		}
		await startSession(c, user)
		await auditRequest(
			c,
			{ event: 'login.success', username: user.username, user_id: user.id },
			ip,
		)

		return c.json({ success: true })
	},
)

authApp.post('/logout', authMiddleware, async (c) => {
	const payload = c.get('jwtPayload')
	await invalidateSession(payload.jti)

	deleteCookie(c, AUTH_COOKIE, getSessionCookieOpts())
	return c.json({ success: true })
})

// Self-service password change. Other sessions of the user end; the
// current one stays signed in.
authApp.post(
	'/password',
	authMiddleware,
	rate_limit(),
	vValidator('json', PasswordChangeSchema, onValidationError),
	async (c) => {
		const user = requestUser(c)
		const ip = peer_ip(c)
		const res = await changeOwnPassword(user.id, c.req.valid('json'))
		if (Result.isOk(res)) {
			await invalidateUserSessions(user.id, c.get('jwtPayload').jti)
			await auditRequest(
				c,
				{ event: 'password.change', username: user.username, user_id: user.id },
				ip,
			)
		}
		return sendResult(
			c,
			res.map(() => ({ success: true })),
		)
	},
)

function sessionUser(user: CurrentUser): SessionUser {
	return {
		username: user.username,
		role: { id: user.role_id, name: user.role_name },
		permissions: [...user.permissions],
		tenant_ids: user.tenant_ids === null ? null : [...user.tenant_ids],
		employee_id: user.employee_id,
		view_as: user.view_as && { id: user.view_as.role_id, name: user.view_as.role_name },
	}
}

authApp.get('/me', authMiddleware, (c) => {
	return c.json(sessionUser(requestUser(c)))
})

/** The user's own role and permissions, which decide the roles offered for viewing as. */
function viewAsOwner(user: CurrentUser): ViewAsOwner {
	return { role_id: user.role_id, permissions: user.own_permissions }
}

// "View as role": the roles this session may view the app as, and switching
// to one or back. Open to every signed-in user: the offered roles grant
// nothing beyond the own role (`canViewAs`), so viewing never escalates.
authApp.get('/view-as', authMiddleware, async (c) => {
	return c.json(await listViewAsRoles(viewAsOwner(requestUser(c))))
})

authApp.put(
	'/view-as',
	authMiddleware,
	vValidator('json', ViewAsSchema, onValidationError),
	async (c) => {
		const sid = c.get('jwtPayload').jti
		const res = await setSessionViewAs(
			sid,
			viewAsOwner(requestUser(c)),
			c.req.valid('json').role_id,
		)
		if (Result.isError(res)) {
			return sendResult(c, res)
		}
		const user = await authenticate(sid, c.get('jwtPayload').sub)
		return user ? c.json(sessionUser(user)) : jsonError(c, 'Unauthorized', 401)
	},
)
