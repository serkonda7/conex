import { getCookie } from 'hono/cookie'
import { createMiddleware } from 'hono/factory'
import { verify } from 'hono/jwt'
import { getUserByUsername } from '../db/users'
import { getSigningKey } from '../keys'
import { touchSession } from '../sessions'
import { type CurrentUser, toCurrentUser } from '../types'
import { jsonError } from '../util/http'

export type JwtPayload = {
	sub: string // Subject (username)
	jti: string // JWT ID, equivalent to session ID
	iat: number // Issued at
	exp: number // expiration time
	// Ignored fields: iss, aud, nbf
}

export const JWT_ALGO = 'HS256'

export const authMiddleware = createMiddleware<{
	Variables: { jwtPayload: JwtPayload; currentUser: CurrentUser }
}>(async (c, next) => {
	const token = getCookie(c, 'auth_token')
	if (!token) {
		return jsonError(c, 'Unauthorized', 401)
	}

	const secret = getSigningKey()

	try {
		const payload = (await verify(token, secret, JWT_ALGO)) as JwtPayload

		if (!touchSession(payload.jti)) {
			return jsonError(c, 'Unauthorized: Session invalidated', 401)
		}

		// Role checks run per request against the live row (not a JWT claim)
		// so admin demotions and tenant re-scopes take effect immediately.
		// Usernames are immutable, so the `sub` lookup cannot go stale.
		const user = getUserByUsername(payload.sub)
		if (!user) {
			return jsonError(c, 'Unauthorized', 401)
		}

		c.set('jwtPayload', payload)
		c.set('currentUser', toCurrentUser(user))
		await next()
	} catch (_e) {
		return jsonError(c, 'Unauthorized', 401)
	}
})
