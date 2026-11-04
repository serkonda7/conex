import type { Permission } from 'shared/src/schemas'

export type { Permission }

export interface User {
	id: number
	username: string
	password_hash: string | null
	provider: string
	provider_id: string | null
	role_id: number
	employee_id: number | null
}

/**
 * Authenticated requester attached to the context by `authMiddleware`.
 * `permissions` come from the user's role, loaded per request.
 * `tenant_ids = null` means global (all tenants); a list limits the user
 * to those tenants (never set for `users.manage` holders). Employee-linked
 * accounts get exactly the employee's tenants (possibly none).
 */
export interface CurrentUser {
	id: number
	username: string
	role_id: number
	role_name: string
	permissions: ReadonlySet<Permission>
	tenant_ids: readonly number[] | null
	/** The employee behind the account, if linked. */
	employee_id: number | null
}
