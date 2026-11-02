import { createHash } from 'node:crypto'
import { Result } from 'better-result'
import type { DirectoryContact } from 'shared/src/schemas'

// ---------------------------------------------------------------------------
// conex API access. LDAP binds are checked by logging in to conex, so the
// Dashboard uses a conex user whose role grants `contacts.directory`; the
// user's tenant scope limits the contacts it sees.
//
// The Dashboard opens a new connection (and bind) per lookup. Sessions are
// therefore reused for repeated binds with the same credentials, which keeps
// login rate limit and audit log quiet. They are re-checked with a fresh login
// after `SESSION_REUSE_MS`, so a changed password takes effect soon.
// ---------------------------------------------------------------------------

const SESSION_REUSE_MS = 15 * 60 * 1000
const REQUEST_TIMEOUT_MS = 10_000

export class ConexError extends Error {
	/** HTTP status of the conex answer; `null` when conex was unreachable. */
	constructor(
		message: string,
		readonly status: number | null,
	) {
		super(message)
	}
}

/** A conex session opened by a bind. */
export interface Login {
	username: string
	password: string
	cookie: string
}

interface CachedSession {
	cookie: string
	createdAt: number
}

export class Conex {
	private readonly sessions = new Map<string, CachedSession>()

	constructor(private readonly baseUrl: string) {}

	/** Session for the credentials: reused, or a fresh conex login. */
	async bind(username: string, password: string): Promise<Result<Login, ConexError>> {
		const key = sessionKey(username, password)
		const cached = this.sessions.get(key)
		if (cached && Date.now() - cached.createdAt < SESSION_REUSE_MS) {
			return Result.ok({ username, password, cookie: cached.cookie })
		}
		this.sessions.delete(key)

		const cookie = await this.login(username, password)
		if (Result.isError(cookie)) {
			return cookie
		}
		const me = await this.get<{ permissions: string[] }>('/auth/me', cookie.value)
		if (Result.isError(me)) {
			return me
		}
		if (!me.value.permissions.includes('contacts.directory')) {
			return Result.err(new ConexError('contacts.directory permission required', 403))
		}
		this.sessions.set(key, { cookie: cookie.value, createdAt: Date.now() })
		return Result.ok({ username, password, cookie: cookie.value })
	}

	/** Contacts visible to the login; logs in again once if its session ended. */
	async contacts(login: Login): Promise<Result<DirectoryContact[], ConexError>> {
		const res = await this.get<DirectoryContact[]>('/directory/contacts', login.cookie)
		if (Result.isError(res) && res.error.status === 401) {
			this.sessions.delete(sessionKey(login.username, login.password))
			const fresh = await this.bind(login.username, login.password)
			if (Result.isError(fresh)) {
				return fresh
			}
			login.cookie = fresh.value.cookie
			return this.get<DirectoryContact[]>('/directory/contacts', login.cookie)
		}
		return res
	}

	private async login(username: string, password: string): Promise<Result<string, ConexError>> {
		const res = await this.request('/auth/login', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ username, password }),
		})
		if (Result.isError(res)) {
			return res
		}
		const cookie = res.value.headers
			.getSetCookie()
			.map((c) => c.split(';')[0] ?? '')
			.find((c) => c.startsWith('auth_token='))
		return cookie
			? Result.ok(cookie)
			: Result.err(new ConexError('conex login returned no session', res.value.status))
	}

	private async get<T>(path: string, cookie: string): Promise<Result<T, ConexError>> {
		const res = await this.request(path, { headers: { Cookie: cookie } })
		if (Result.isError(res)) {
			return res
		}
		return Result.tryPromise({
			try: () => res.value.json() as Promise<T>,
			catch: () => new ConexError(`Invalid response from conex ${path}`, res.value.status),
		})
	}

	/** Fetch that maps transport errors and non-2xx answers to `ConexError`. */
	private async request(path: string, init: RequestInit): Promise<Result<Response, ConexError>> {
		const res = await Result.tryPromise({
			try: () =>
				fetch(`${this.baseUrl}${path}`, {
					...init,
					signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
				}),
			catch: (e: unknown) =>
				new ConexError(
					`conex unreachable: ${e instanceof Error ? e.message : String(e)}`,
					null,
				),
		})
		if (Result.isError(res) || res.value.ok) {
			return res
		}
		const body = (await res.value.json().catch(() => null)) as { error?: string } | null
		return Result.err(
			new ConexError(
				`conex ${path}: ${body?.error ?? `HTTP ${res.value.status}`}`,
				res.value.status,
			),
		)
	}
}

function sessionKey(username: string, password: string): string {
	return `${username.toLowerCase()}\0${createHash('sha256').update(password).digest('hex')}`
}
