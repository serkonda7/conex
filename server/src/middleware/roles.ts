import { createMiddleware } from 'hono/factory'
import { requireAdmin, requireGlobalWrite, requireWrite } from '../authz'

export const requireWriteMiddleware = createMiddleware(async (c, next) => {
	const denied = requireWrite(c)
	if (denied) {
		return denied
	}
	await next()
})

export const requireGlobalWriteMiddleware = createMiddleware(async (c, next) => {
	const denied = requireGlobalWrite(c)
	if (denied) {
		return denied
	}
	await next()
})

export const requireAdminMiddleware = createMiddleware(async (c, next) => {
	const denied = requireAdmin(c)
	if (denied) {
		return denied
	}
	await next()
})
