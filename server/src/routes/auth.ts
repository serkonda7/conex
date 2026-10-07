import { vValidator } from '@hono/valibot-validator'
import { Result } from 'better-result'
import { type Context, Hono } from 'hono'
import { deleteCookie, setCookie } from 'hono/cookie'
import { LoginSchema, PasswordChangeSchema, SetupSchema } from 'shared/src/schemas'
import { requestUser } from '../authz'
import { isUniqueViolation } from '../db/errors'
import { fullAccessRoleId } from '../db/roles'
import { changeOwnPassword, createLocalUser, getUserByUsername, hasAnyUser } from '../db/users'
import { authMiddleware } from '../middleware/auth'
import { rate_limit } from '../middleware/rate_limit'
import { onValidationError } from '../middleware/validation'
import {
	get_signed_jwt,
	getSessionCookieOpts,
	invalidateSession,
	invalidateUserSessions,
} from '../sessions'
import type { User } from '../types'
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
			const user = await createLocalUser(
				username,
				password_hash,
				await fullAccessRoleId(),
				null,
			)
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

		const isMatch = await Bun.password.verify(body.password, user.password_hash)
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

authApp.get('/me', authMiddleware, (c) => {
	const user = requestUser(c)
	return c.json({
		username: user.username,
		role: { id: user.role_id, name: user.role_name },
		permissions: [...user.permissions],
		tenant_id: user.tenant_id,
	})
})
