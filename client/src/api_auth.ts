/**
 * Auth API wrapper: the single home for the raw auth fetches.
 *
 * Login/logout/session-checks carry cookies rather than RPC payloads, so they
 * bypass the typed `hono/client` RPC in `api.ts`. They still live here instead
 * of inline in components, so endpoint paths and `{ error }` parsing exist once.
 */
import type { Result } from 'better-result'
import type { Role } from 'shared/src/types'
import { post_json } from './api'
import { t } from './i18n'

export type AuthProviders = { local: boolean; microsoft: boolean }

export async function fetchProviders(): Promise<AuthProviders | undefined> {
	try {
		const res = await fetch('/api/auth/providers')
		if (!res.ok) {
			return undefined
		}
		return (await res.json()) as AuthProviders
	} catch {
		return undefined
	}
}

/** True when no admin account exists yet. Never throws: null on network error. */
export async function fetchSetupStatus(): Promise<boolean | null> {
	try {
		const res = await fetch('/api/auth/setup-status')
		if (!res.ok) {
			return null
		}
		const data = (await res.json()) as { needsSetup?: unknown }
		return data.needsSetup === true
	} catch {
		return null
	}
}

/** Creates the first admin account (first-run only) and sets the session cookie. */
export async function setupAdmin(username: string, password: string): Promise<Result<void, Error>> {
	const res = await post_json<unknown>(
		'/api/auth/setup',
		{ username, password },
		t('api.setupFailed'),
		t('api.networkError'),
	)
	return res.map(() => undefined)
}

/** Current session identity: username plus the RBAC role and tenant scope. */
export interface SessionUser {
	username: string
	role: Role
	tenant_id: number | null
}

/** Current session identity, or null when logged out/unreachable. Never throws. */
export async function fetchMe(): Promise<SessionUser | null> {
	try {
		const res = await fetch('/api/auth/me')
		if (!res.ok) {
			return null
		}
		const data = (await res.json()) as Partial<SessionUser>
		if (typeof data.username !== 'string') {
			return null
		}
		return {
			username: data.username,
			role:
				data.role === 'admin' || data.role === 'editor' || data.role === 'viewer'
					? data.role
					: 'viewer',
			tenant_id: typeof data.tenant_id === 'number' ? data.tenant_id : null,
		}
	} catch {
		return null
	}
}

/** Logs in and lets the server set the session cookie. */
export async function login(username: string, password: string): Promise<Result<void, Error>> {
	const res = await post_json<unknown>(
		'/api/auth/login',
		{ username, password },
		t('api.signInFailed'),
		t('api.networkError'),
	)
	return res.map(() => undefined)
}

/** Releases the server session. Never throws: logout is best-effort. */
export async function logout(): Promise<void> {
	try {
		await fetch('/api/auth/logout', { method: 'POST' })
	} catch (err) {
		console.error('Logout failed', err)
	}
}
