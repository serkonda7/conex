import { getCookie } from 'hono/cookie'
import { createMiddleware } from 'hono/factory'
import { verify } from 'hono/jwt'
import { runAsActor } from '../db/changelog'
import { getSigningKey } from '../keys'
import { authenticate } from '../sessions'
import type { CurrentUser } from '../types'
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

		// One statement validates the session and loads the live user, role
		// and scope rows (not JWT claims), so role changes, permission edits
		// and tenant re-scopes take effect immediately. Usernames are
		// immutable, so the `sub` check cannot go stale.
		const user = await authenticate(payload.jti, payload.sub)
		if (!user) {
			return jsonError(c, 'Unauthorized: Session invalidated', 401)
		}

		c.set('jwtPayload', payload)
		c.set('currentUser', user)
		// Changes recorded while handling this request are attributed to the user.
		await runAsActor(
			{ user_id: user.id, username: user.username, request_id: crypto.randomUUID() },
			next,
		)
	} catch (_e) {
		return jsonError(c, 'Unauthorized', 401)
	}
})
