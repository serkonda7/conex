import type { Permission } from 'shared/src/schemas'

export type { Permission }

export interface User {
	id: number
	username: string
	password_hash: string | null
	provider: string
	provider_id: string | null
	role_id: number
	tenant_id: number | null
}

/**
 * Authenticated requester attached to the context by `authMiddleware`.
 * `permissions` come from the user's role, loaded per request.
 * `tenant_id = null` means global (all tenants); a number limits the user
 * to that single tenant (never set for `users.manage` holders).
 */
export interface CurrentUser {
	id: number
	username: string
	role_id: number
	role_name: string
	permissions: ReadonlySet<Permission>
	tenant_id: number | null
}
