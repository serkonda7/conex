import type { Role } from 'shared/src/schemas'

export type { Role }

export interface User {
	id: number
	username: string
	password_hash: string | null
	provider: string
	provider_id: string | null
	role: Role
	tenant_id: number | null
}

/**
 * Authenticated requester attached to the context by `authMiddleware`.
 * `tenant_id = null` means global (all tenants); a number limits editors
 * and viewers to that single tenant. Admins ignore tenant scope.
 */
export interface CurrentUser {
	id: number
	username: string
	role: Role
	tenant_id: number | null
}

export function toCurrentUser(user: User): CurrentUser {
	return { id: user.id, username: user.username, role: user.role, tenant_id: user.tenant_id }
}
