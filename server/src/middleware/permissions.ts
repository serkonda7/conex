import type { MiddlewareHandler } from 'hono'
import { createMiddleware } from 'hono/factory'
import { requireGlobalPermission, requirePermission } from '../authz'
import type { Permission } from '../types'

/** Route gate: 403 unless the requester's role grants `permission`. */
export function requirePermissionMiddleware(permission: Permission): MiddlewareHandler {
	return createMiddleware(async (c, next) => {
		const denied = requirePermission(c, permission)
		if (denied) {
			return denied
		}
		await next()
	})
}

/** Route gate for shared data: `permission` plus a global (unscoped) requester. */
export function requireGlobalPermissionMiddleware(permission: Permission): MiddlewareHandler {
	return createMiddleware(async (c, next) => {
		const denied = requireGlobalPermission(c, permission)
		if (denied) {
			return denied
		}
		await next()
	})
}
