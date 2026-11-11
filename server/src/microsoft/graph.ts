/**
 * Minimal Microsoft Graph client shared by the calendar sync and the M365
 * integration: plain `fetch`, no SDK, every call returns a `Result`.
 *
 * Auth is the OAuth 2.0 client-credentials flow of an Entra app; each feature
 * brings its own app registration and permissions (least privilege). Tokens
 * are cached per tenant/app/secret until shortly before they expire.
 * Throttled requests (429, 503, 504) are retried a few times, honouring
 * `Retry-After`.
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

/** True for a 404 (resource gone). */
export function isGraphNotFound(error: Error): boolean {
	return error instanceof GraphApiError && error.status === 404
}

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0'
const LOGIN_BASE = 'https://login.microsoftonline.com'
const SCOPE = 'https://graph.microsoft.com/.default'

const MAX_ATTEMPTS = 4
const MAX_RETRY_DELAY_MS = 30_000
/** Renew tokens this long before they expire. */
const TOKEN_MARGIN_S = 120

const TokenResponseSchema = v.object({
	access_token: v.pipe(v.string(), v.minLength(1)),
	expires_in: v.pipe(v.union([v.number(), v.string()]), v.transform(Number), v.number()),
})

/** One page of a Graph collection; `@odata.nextLink` is absolute. */
const PageSchema = v.object({
	value: v.array(v.unknown()),
	'@odata.nextLink': v.optional(v.string()),
})

/** Upper bound for `getAll`, against a server that keeps returning next links. */
const MAX_PAGES = 1000

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

export interface GraphRequestOptions {
	body?: unknown
	/**
	 * Sends `ConsistencyLevel: eventual`, which advanced queries need
	 * (`$count`, `$search`, `endsWith`, `ne` filters on directory objects).
	 */
	eventual?: boolean
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

	/**
	 * Authenticated Graph request; one fresh token on 401. `path` is relative
	 * to the v1.0 endpoint, or an absolute Graph URL (`@odata.nextLink`).
	 */
	async request(
		what: string,
		method: string,
		path: string,
		options: GraphRequestOptions = {},
	): Promise<Result<Response, Error>> {
		const { body, eventual } = options
		const url = path.startsWith('https://') ? path : `${GRAPH_BASE}${path}`
		for (let attempt = 0; attempt < 2; attempt++) {
			const token = await this.token()
			if (Result.isError(token)) {
				return token
			}
			const res = await send(what, url, {
				method,
				headers: {
					authorization: `Bearer ${token.value}`,
					...(body !== undefined ? { 'content-type': 'application/json' } : {}),
					...(eventual ? { consistencylevel: 'eventual' } : {}),
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

	/** GET of one resource, validated against `schema`. */
	async getJson<T>(
		what: string,
		path: string,
		schema: v.GenericSchema<unknown, T>,
		options: Omit<GraphRequestOptions, 'body'> = {},
	): Promise<Result<T, Error>> {
		const res = await this.request(what, 'GET', path, options)
		if (Result.isError(res)) {
			return res
		}
		const parsed = v.safeParse(schema, await res.value.json().catch(() => null))
		return parsed.success
			? Result.ok(parsed.output)
			: Result.err(
					new GraphApiError(`Microsoft Graph ${what} returned an unexpected body`, null),
				)
	}

	/**
	 * Every item of a collection: follows `@odata.nextLink` and validates each
	 * item against `schema` (an invalid item fails the whole call).
	 */
	async getAll<T>(
		what: string,
		path: string,
		schema: v.GenericSchema<unknown, T>,
		options: Omit<GraphRequestOptions, 'body'> = {},
	): Promise<Result<T[], Error>> {
		const items: T[] = []
		let next: string | undefined = path
		for (let page = 0; next !== undefined; page++) {
			if (page >= MAX_PAGES) {
				return Result.err(
					new GraphApiError(`Microsoft Graph ${what} returned too many pages`, null),
				)
			}
			const res: Result<v.InferOutput<typeof PageSchema>, Error> = await this.getJson(
				what,
				next,
				PageSchema,
				options,
			)
			if (Result.isError(res)) {
				return res
			}
			for (const raw of res.value.value) {
				const item = v.safeParse(schema, raw)
				if (!item.success) {
					return Result.err(
						new GraphApiError(
							`Microsoft Graph ${what} returned an unexpected item`,
							null,
						),
					)
				}
				items.push(item.output)
			}
			next = res.value['@odata.nextLink']
		}
		return Result.ok(items)
	}
}
