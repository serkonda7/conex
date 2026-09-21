import { vValidator } from '@hono/valibot-validator'
import { Hono } from 'hono'
import { deleteCookie, setCookie } from 'hono/cookie'
import { LoginSchema, SetupSchema } from 'shared/src/schemas'
import { requestUser } from '../authz'
import { getConfig } from '../config'
import { isUniqueViolation } from '../db/errors'
import { createLocalUser, getUserByUsername, hasAnyUser } from '../db/users'
import { authMiddleware } from '../middleware/auth'
import { rate_limit } from '../middleware/rate_limit'
import { onValidationError } from '../middleware/validation'
import { get_signed_jwt, getSessionCookieOpts, invalidateSession } from '../sessions'
import { jsonError } from '../util/http'
import { normalize_username } from '../util/username'

export const authApp = new Hono()

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

authApp.get('/setup-status', (c) => {
	return c.json({ needsSetup: !hasAnyUser() })
})

authApp.post(
	'/setup',
	rate_limit(),
	vValidator('json', SetupSchema, onValidationError),
	async (c) => {
		if (hasAnyUser()) {
			return jsonError(c, 'Setup already completed', 409)
		}

		const body = c.req.valid('json')
		const username = normalize_username(body.username)
		if (!username) {
			return jsonError(c, 'Username and password are required.', 400)
		}

		if (getUserByUsername(username)) {
			return jsonError(c, 'Setup already completed', 409)
		}

		try {
			const password_hash = await Bun.password.hash(body.password)
			// First account owns the instance: always an admin (createLocalUser
			// defaults to `admin`; passed explicitly so the role survives any
			// future default change).
			const user = createLocalUser(username, password_hash, 'admin', null)
			const token = await get_signed_jwt(user)
			setCookie(c, 'auth_token', token, getSessionCookieOpts())
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

		const user = getUserByUsername(body.username)
		if (!user) {
			return jsonError(c, 'Invalid username or password', 401)
		}

		if (!user.password_hash) {
			return jsonError(c, 'Invalid username or password', 401)
		}

		const isMatch = await Bun.password.verify(body.password, user.password_hash)
		if (!isMatch) {
			return jsonError(c, 'Invalid username or password', 401)
		}
		const token = await get_signed_jwt(user)
		setCookie(c, 'auth_token', token, getSessionCookieOpts())

		return c.json({ success: true })
	},
)

authApp.post('/logout', authMiddleware, async (c) => {
	const payload = c.get('jwtPayload')
	invalidateSession(payload.jti)

	deleteCookie(c, 'auth_token', {
		path: '/',
		secure: getConfig().auth.secureCookies,
		sameSite: 'Strict',
	})
	return c.json({ success: true })
})

authApp.get('/me', authMiddleware, (c) => {
	const user = requestUser(c)
	return c.json({ username: user.username, role: user.role, tenant_id: user.tenant_id })
})
