/**
 * Minimal Microsoft Graph client for the calendar sync: plain `fetch`, no
 * SDK, every call returns a `Result`.
 *
 * Auth is the OAuth 2.0 client-credentials flow of an Entra app with the
 * application permission `Calendars.ReadWrite`; tokens are cached per
 * tenant/app/secret until shortly before they expire. Throttled requests
 * (429, 503, 504) are retried a few times, honouring `Retry-After`.
 */
import { createHash } from 'node:crypto'
import { Result } from 'better-result'
import * as v from 'valibot'

export interface GraphCredentials {
	ms_tenant_id: string
	client_id: string
	client_secret: string
}

/** HTTP failure of a Graph or token call; `status` null when nothing came back. */
export class GraphApiError extends Error {
	constructor(
		message: string,
		readonly status: number | null,
		readonly code: string | null = null,
	) {
		super(message)
		this.name = 'GraphApiError'
	}
}

/** True for a 404 (event or mailbox gone). */
export function isGraphNotFound(error: Error): boolean {
	return error instanceof GraphApiError && error.status === 404
}

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0'
const LOGIN_BASE = 'https://login.microsoftonline.com'
const SCOPE = 'https://graph.microsoft.com/.default'

/** Fixed property set of the `conexTanssId` extended property. */
export const TANSS_ID_PROPERTY = 'String {5b0f9a3e-6c1d-4f4e-9a8b-2f1c7d3e8a51} Name conexTanssId'

/** Category on every synced event. */
export const TANSS_CATEGORY = 'TANSS'

const MAX_ATTEMPTS = 4
const MAX_RETRY_DELAY_MS = 30_000
/** Renew tokens this long before they expire. */
const TOKEN_MARGIN_S = 120

const TokenResponseSchema = v.object({
	access_token: v.pipe(v.string(), v.minLength(1)),
	expires_in: v.pipe(v.union([v.number(), v.string()]), v.transform(Number), v.number()),
})

const EventResponseSchema = v.object({ id: v.pipe(v.string(), v.minLength(1)) })

const ErrorBodySchema = v.object({
	error: v.union([
		v.object({ code: v.optional(v.string()), message: v.optional(v.string()) }),
		v.string(),
	]),
	error_description: v.optional(v.string()),
})

interface CachedToken {
	token: string
	expiresAt: number
}

const tokens = new Map<string, CachedToken>()

function cacheKey(creds: GraphCredentials): string {
	return createHash('sha256')
		.update(`${creds.ms_tenant_id}\n${creds.client_id}\n${creds.client_secret}`)
		.digest('hex')
}

function errMessage(e: unknown): string {
	return e instanceof Error ? e.message : String(e)
}

/** `{ error: { code, message } }` (Graph) or `{ error, error_description }` (token endpoint). */
async function errorOf(what: string, res: Response): Promise<GraphApiError> {
	const body = await res.json().catch(() => null)
	const parsed = v.safeParse(ErrorBodySchema, body)
	let code: string | null = null
	let detail = `HTTP ${res.status}`
	if (parsed.success) {
		const { error, error_description } = parsed.output
		if (typeof error === 'string') {
			code = error
			detail = error_description?.split(/\r?\n/)[0] ?? error
		} else {
			code = error.code ?? null
			detail = error.message ?? error.code ?? detail
		}
	}
	return new GraphApiError(`Microsoft Graph ${what} failed: ${detail}`, res.status, code)
}

/** Seconds (or HTTP date) of `Retry-After`, as a capped delay in ms. */
function retryDelayMs(res: Response, attempt: number): number {
	const header = res.headers.get('retry-after')
	let ms = 2 ** attempt * 1000
	if (header !== null) {
		const seconds = Number(header)
		if (Number.isFinite(seconds)) {
			ms = seconds * 1000
		} else {
			const at = Date.parse(header)
			if (!Number.isNaN(at)) {
				ms = at - Date.now()
			}
		}
	}
	return Math.min(Math.max(ms, 0), MAX_RETRY_DELAY_MS)
}

/** `fetch` with retries on throttling; network errors become a `GraphApiError`. */
async function send(
	what: string,
	url: string,
	init: RequestInit,
): Promise<Result<Response, GraphApiError>> {
	for (let attempt = 1; ; attempt++) {
		const res = await Result.tryPromise({
			try: () => fetch(url, init),
			catch: (e: unknown) =>
				new GraphApiError(`Microsoft Graph ${what} failed: ${errMessage(e)}`, null),
		})
		if (Result.isError(res)) {
			return res
		}
		const status = res.value.status
		if ((status === 429 || status === 503 || status === 504) && attempt < MAX_ATTEMPTS) {
			await Bun.sleep(retryDelayMs(res.value, attempt))
			continue
		}
		return res
	}
}

/** One app registration in one Entra tenant. */
export class GraphClient {
	constructor(private readonly creds: GraphCredentials) {}

	/** Access token from the cache or a new client-credentials request. */
	async token(): Promise<Result<string, Error>> {
		const key = cacheKey(this.creds)
		const cached = tokens.get(key)
		if (cached && cached.expiresAt > Date.now() / 1000) {
			return Result.ok(cached.token)
		}
		const res = await send(
			'token request',
			`${LOGIN_BASE}/${encodeURIComponent(this.creds.ms_tenant_id)}/oauth2/v2.0/token`,
			{
				method: 'POST',
				headers: { 'content-type': 'application/x-www-form-urlencoded' },
				body: new URLSearchParams({
					client_id: this.creds.client_id,
					client_secret: this.creds.client_secret,
					scope: SCOPE,
					grant_type: 'client_credentials',
				}),
			},
		)
		if (Result.isError(res)) {
			return res
		}
		if (!res.value.ok) {
			return Result.err(await errorOf('token request', res.value))
		}
		const body = await res.value.json().catch(() => null)
		const parsed = v.safeParse(TokenResponseSchema, body)
		if (!parsed.success) {
			return Result.err(
				new GraphApiError('Microsoft Graph token request returned no access token', null),
			)
		}
		const { access_token, expires_in } = parsed.output
		tokens.set(key, {
			token: access_token,
			expiresAt: Date.now() / 1000 + expires_in - TOKEN_MARGIN_S,
		})
		return Result.ok(access_token)
	}

	/** Authenticated Graph request; one fresh token on 401. */
	private async request(
		what: string,
		method: string,
		path: string,
		body?: unknown,
	): Promise<Result<Response, Error>> {
		for (let attempt = 0; attempt < 2; attempt++) {
			const token = await this.token()
			if (Result.isError(token)) {
				return token
			}
			const res = await send(what, `${GRAPH_BASE}${path}`, {
				method,
				headers: {
					authorization: `Bearer ${token.value}`,
					...(body !== undefined ? { 'content-type': 'application/json' } : {}),
				},
				body: body !== undefined ? JSON.stringify(body) : undefined,
			})
			if (Result.isError(res)) {
				return res
			}
			if (res.value.status === 401 && attempt === 0) {
				tokens.delete(cacheKey(this.creds))
				continue
			}
			if (!res.value.ok) {
				return Result.err(await errorOf(what, res.value))
			}
			return Result.ok(res.value)
		}
		return Result.err(new GraphApiError(`Microsoft Graph ${what} failed: unauthorized`, 401))
	}

	/** Reads the mailbox's main calendar: proves permission and scoping for `upn`. */
	async verify(upn: string): Promise<Result<void, Error>> {
		const res = await this.request(
			`calendar check for ${upn}`,
			'GET',
			`/users/${encodeURIComponent(upn)}/calendar?$select=id`,
		)
		return res.map(() => undefined)
	}

	/** Creates an event in the main calendar and returns its id. */
	async createEvent(upn: string, event: GraphEvent): Promise<Result<string, Error>> {
		const res = await this.request(
			`event create for ${upn}`,
			'POST',
			`/users/${encodeURIComponent(upn)}/events`,
			event,
		)
		if (Result.isError(res)) {
			return res
		}
		const parsed = v.safeParse(EventResponseSchema, await res.value.json().catch(() => null))
		if (!parsed.success) {
			return Result.err(
				new GraphApiError('Microsoft Graph event create returned no event id', null),
			)
		}
		return Result.ok(parsed.output.id)
	}

	/** Overwrites the given event fields; 404 when the user deleted the event. */
	async updateEvent(
		upn: string,
		eventId: string,
		event: GraphEvent,
	): Promise<Result<void, Error>> {
		const res = await this.request(
			`event update for ${upn}`,
			'PATCH',
			`/users/${encodeURIComponent(upn)}/events/${encodeURIComponent(eventId)}`,
			event,
		)
		return res.map(() => undefined)
	}

	async deleteEvent(upn: string, eventId: string): Promise<Result<void, Error>> {
		const res = await this.request(
			`event delete for ${upn}`,
			'DELETE',
			`/users/${encodeURIComponent(upn)}/events/${encodeURIComponent(eventId)}`,
		)
		return res.map(() => undefined)
	}
}

/** The `event` resource fields the sync writes. */
export interface GraphEvent {
	subject: string
	body: { contentType: 'text' | 'html'; content: string }
	/** `dateTime` without offset, interpreted in `timeZone`. */
	start: { dateTime: string; timeZone: 'UTC' }
	end: { dateTime: string; timeZone: 'UTC' }
	location: { displayName: string }
	showAs: 'busy'
	isReminderOn: boolean
	categories: string[]
	singleValueExtendedProperties: { id: string; value: string }[]
}
