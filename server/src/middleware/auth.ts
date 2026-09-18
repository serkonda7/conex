import { getCookie } from 'hono/cookie'
import { createMiddleware } from 'hono/factory'
import { verify } from 'hono/jwt'
import { getSigningKey } from '../keys'
import { touchSession } from '../sessions'
import { jsonError } from '../util/http'

export type JwtPayload = {
	sub: string // Subject (user email)
	jti: string // JWT ID, equivalent to session ID
	iat: number // Issued at
	exp: number // expiration time
	// Ignored fields: iss, aud, nbf
}

export const JWT_ALGO = 'HS256'

export const authMiddleware = createMiddleware<{ Variables: { jwtPayload: JwtPayload } }>(
	async (c, next) => {
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

			c.set('jwtPayload', payload)
			await next()
		} catch (_e) {
			return jsonError(c, 'Unauthorized', 401)
		}
	},
)
