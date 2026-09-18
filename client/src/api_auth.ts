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
export async function setupAdmin(email: string, password: string): Promise<Result<void, Error>> {
	try {
		const res = await fetch('/api/auth/setup', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ email, password }),
		})

		if (!res.ok) {
			return Result.err(new Error(await read_api_error(res, 'Setup failed.')))
		}

		return Result.ok(undefined)
	} catch {
		return Result.err(new Error('A network error occurred. Please try again.'))
	}
}

/** Current session email, or null when logged out/unreachable. Never throws. */
export async function fetchMe(): Promise<string | null> {
	try {
		const res = await fetch('/api/auth/me')
		if (!res.ok) {
			return null
		}
		const data = (await res.json()) as { email?: unknown }
		return typeof data.email === 'string' ? data.email : null
	} catch {
		return null
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
