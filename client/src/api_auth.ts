/**
 * Auth API wrapper: the single home for the raw auth fetches.
 *
 * Login/logout/session-checks carry cookies rather than RPC payloads, so they
 * bypass the typed `hono/client` RPC in `api.ts`. They still live here instead
 * of inline in components, so endpoint paths and `{ error }` parsing exist once.
 */
import { Result } from 'better-result'
import { read_api_error } from './util/api_error'

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

/** True when the server session is alive. Never throws. */
export async function fetchMe(): Promise<boolean> {
	try {
		const res = await fetch('/api/auth/me')
		return res.ok
	} catch {
		return false
	}
}

/** Logs in and lets the server set the session cookie. */
export async function login(email: string, password: string): Promise<Result<void, Error>> {
	try {
		const res = await fetch('/api/auth/login', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ email, password }),
		})

		if (!res.ok) {
			return Result.err(new Error(await read_api_error(res, 'Sign-in failed.')))
		}

		return Result.ok(undefined)
	} catch {
		return Result.err(new Error('A network error occurred. Please try again.'))
	}
}

/** Releases the server session. Never throws: logout is best-effort. */
export async function logout(): Promise<void> {
	try {
		await fetch('/api/auth/logout', { method: 'POST' })
	} catch (err) {
		console.error('Logout failed', err)
	}
}
