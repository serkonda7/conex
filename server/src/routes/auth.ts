import { vValidator } from '@hono/valibot-validator'
import { Result } from 'better-result'
import { type Context, Hono } from 'hono'
import { deleteCookie, setCookie } from 'hono/cookie'
import { type AuditEvent, LoginSchema, SetupSchema } from 'shared/src/schemas'
import { requestUser } from '../authz'
import { getConfig } from '../config'
import { recordAudit } from '../db/audit'
import { isUniqueViolation } from '../db/errors'
import { createLocalUser, getUserByUsername, hasAnyUser } from '../db/users'
import { authMiddleware } from '../middleware/auth'
import { rate_limit } from '../middleware/rate_limit'
import { onValidationError } from '../middleware/validation'
import { get_signed_jwt, getSessionCookieOpts, invalidateSession } from '../sessions'
import { forwarded_for, peer_ip } from '../util/client_ip'
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
			// First account owns the instance: always an admin (createLocalUser
			// defaults to `admin`; passed explicitly so the role survives any
			// future default change).
			const user = await createLocalUser(username, password_hash, 'admin', null)
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

/**
 * Appends a login attempt to the audit log. A failed write is logged but
 * never changes the login outcome.
 */
async function auditLogin(
	c: Context,
	ip: string,
	event: AuditEvent,
	username: string,
	userId: number | null,
): Promise<void> {
	const res = await recordAudit({
		event,
		username,
		user_id: userId,
		ip,
		forwarded_for: forwarded_for(c),
		user_agent: c.req.header('user-agent') ?? null,
	})
	if (Result.isError(res)) {
		console.error('Failed to write audit log entry:', res.error)
	}
}

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
			await auditLogin(c, ip, 'login.failure', body.username, user?.id ?? null)
			return jsonError(c, 'Invalid username or password', 401)
		}

		const isMatch = await Bun.password.verify(body.password, user.password_hash)
		if (!isMatch) {
			await auditLogin(c, ip, 'login.failure', user.username, user.id)
			return jsonError(c, 'Invalid username or password', 401)
		}
		const token = await get_signed_jwt(user)
		setCookie(c, 'auth_token', token, getSessionCookieOpts())
		await auditLogin(c, ip, 'login.success', user.username, user.id)

		return c.json({ success: true })
	},
)

authApp.post('/logout', authMiddleware, async (c) => {
	const payload = c.get('jwtPayload')
	await invalidateSession(payload.jti)

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
