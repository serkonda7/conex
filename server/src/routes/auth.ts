import { vValidator } from '@hono/valibot-validator'
import { Hono } from 'hono'
import { deleteCookie, setCookie } from 'hono/cookie'
import { LoginSchema } from 'shared/src/schemas'
import { logLoginAttempt } from '../audit'
import { getConfig } from '../config'
import { getUserByEmail } from '../db/users'
import { authMiddleware } from '../middleware/auth'
import { rate_limit } from '../middleware/rate_limit'
import { onValidationError } from '../middleware/validation'
import { get_signed_jwt, getSessionCookieOpts, invalidateSession } from '../sessions'
import { jsonError } from '../util/http'

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

authApp.post(
	'/login',
	rate_limit(),
	vValidator('json', LoginSchema, onValidationError),
	async (c) => {
		const body = c.req.valid('json')

		const user = getUserByEmail(body.email)
		if (!user) {
			logLoginAttempt({ email: body.email, action: 'login.failure' })
			return jsonError(c, 'Invalid email or password', 401)
		}

		if (!user.password_hash) {
			logLoginAttempt({ email: body.email, userId: user.id, action: 'login.failure' })
			return jsonError(c, 'Invalid email or password', 401)
		}

		const isMatch = await Bun.password.verify(body.password, user.password_hash)
		if (!isMatch) {
			logLoginAttempt({ email: body.email, userId: user.id, action: 'login.failure' })
			return jsonError(c, 'Invalid email or password', 401)
		}

		logLoginAttempt({ email: user.email, userId: user.id, action: 'login.success' })
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
	const payload = c.get('jwtPayload')
	return c.json({ email: payload.sub })
})
