/**
 * Auth API wrapper: the single home for the raw auth fetches.
 *
 * Login/logout/session-checks carry cookies rather than RPC payloads, so they
 * bypass the typed `hono/client` RPC in `client.ts`. They still live here instead
 * of inline in components, so endpoint paths and `{ error }` parsing exist once.
 */
import { Result } from 'better-result'
import { type SessionUser, SessionUserSchema, type ViewAsRoleJson } from 'shared/src/schemas'
import * as v from 'valibot'
import { t } from '../i18n'
import { api_fetch } from '../lib/query'
import { post_json, to_result } from './client'

export type { SessionUser, ViewAsRoleJson }

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

/** Current session identity, or null when logged out/unreachable. Never throws. */
export async function fetchMe(): Promise<SessionUser | null> {
	try {
		const res = await fetch('/api/auth/me')
		if (!res.ok) {
			return null
		}
		const parsed = v.safeParse(SessionUserSchema, await res.json())
		return parsed.success ? parsed.output : null
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

/** Changes the signed-in user's password; their other sessions end. */
export async function change_password(
	current_password: string,
	new_password: string,
): Promise<Result<void, Error>> {
	const res = await post_json<unknown>(
		'/api/auth/password',
		{ current_password, new_password },
		t('api.passwordChangeFailed'),
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

/** Roles the signed-in user may view the app as (none granting more than the own role). */
export async function fetchViewAsRoles(): Promise<Result<ViewAsRoleJson[], Error>> {
	try {
		return await to_result<ViewAsRoleJson[]>(
			await api_fetch('/api/auth/view-as'),
			t('api.viewAsRolesFailed'),
		)
	} catch {
		return Result.err(new Error(t('api.networkError')))
	}
}

/** Views the app as role `roleId` (null = own role); returns the session's new identity. */
export async function setViewAs(roleId: number | null): Promise<Result<SessionUser, Error>> {
	try {
		const res = await api_fetch('/api/auth/view-as', {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ role_id: roleId }),
		})
		const body = await to_result<unknown>(res, t('api.viewAsFailed'))
		if (Result.isError(body)) {
			return body
		}
		const parsed = v.safeParse(SessionUserSchema, body.value)
		return parsed.success
			? Result.ok(parsed.output)
			: Result.err(new Error(t('api.viewAsFailed')))
	} catch {
		return Result.err(new Error(t('api.networkError')))
	}
}
