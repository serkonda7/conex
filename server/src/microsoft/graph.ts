/**
 * Microsoft Graph access shared by the calendar sync and the M365
 * integration, on top of `@microsoft/msgraph-sdk`. Every call returns a
 * `Result`; SDK and auth failures become a `GraphApiError`.
 *
 * Auth is the OAuth 2.0 client-credentials flow of an Entra app; each feature
 * brings its own app registration and permissions (least privilege). One
 * credential (and with it MSAL's token cache) is kept per tenant/app/secret.
 * The SDK's default middleware retries throttled requests (429, 503, 504),
 * honouring `Retry-After`.
 *
 * The fluent API only exposes the resources whose package is imported, e.g.
 * `import '@microsoft/msgraph-sdk-users'` for `api.users`.
 */
import { createHash } from 'node:crypto'
import { AuthenticationError, ClientSecretCredential } from '@azure/identity'
import {
	createGraphServiceClient,
	GraphRequestAdapter,
	type GraphServiceClient,
} from '@microsoft/msgraph-sdk'
import { GraphAzureIdentityAuthenticationProvider } from '@microsoft/msgraph-sdk-core'
import { Result } from 'better-result'

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

const SCOPE = 'https://graph.microsoft.com/.default'

/**
 * Request headers for advanced queries (`$count`, `$search`, `endsWith`,
 * `ne` filters on directory objects).
 */
export const EVENTUAL_CONSISTENCY = { ConsistencyLevel: 'eventual' }

/** Upper bound for `getAll`, against a server that keeps returning next links. */
const MAX_PAGES = 1000

const credentials = new Map<string, ClientSecretCredential>()

/** Cached per tenant/app/secret, so tokens outlive one `GraphClient`. */
function credentialOf(creds: GraphCredentials): ClientSecretCredential {
	const key = createHash('sha256')
		.update(`${creds.ms_tenant_id}\n${creds.client_id}\n${creds.client_secret}`)
		.digest('hex')
	let credential = credentials.get(key)
	if (!credential) {
		credential = new ClientSecretCredential(
			creds.ms_tenant_id,
			creds.client_id,
			creds.client_secret,
		)
		credentials.set(key, credential)
	}
	return credential
}

/** First line of a message; Entra error descriptions append trace ids and timestamps. */
function firstLine(text: string): string {
	return text.split(/\r?\n/)[0] ?? text
}

/**
 * Entra's answer inside MSAL's `ServerError` (wrapped as the `cause` of
 * `AuthenticationRequiredError`). `errorMessage` reads
 * `Error(s): … - Description: AADSTS…: <text> Trace ID: …`.
 */
function msalError(what: string, e: Error): GraphApiError | null {
	const cause: unknown = e.cause
	if (!(cause instanceof Error) || !('errorCode' in cause) || !('errorMessage' in cause)) {
		return null
	}
	const code = typeof cause.errorCode === 'string' && cause.errorCode ? cause.errorCode : null
	const raw = typeof cause.errorMessage === 'string' ? cause.errorMessage : ''
	const detail =
		raw.match(/Description: (.*?)(?:\s+Trace ID:|\r?\n|$)/s)?.[1] ||
		firstLine(raw) ||
		code ||
		e.message
	const status = 'status' in cause && typeof cause.status === 'number' ? cause.status : null
	return new GraphApiError(`Microsoft Graph ${what} failed: ${detail}`, status, code)
}

/** Graph `ODataError`/`ApiError`, Entra/MSAL auth errors, or a network failure. */
function toGraphError(what: string, e: unknown): GraphApiError {
	if (e instanceof GraphApiError) {
		return e
	}
	const msal = e instanceof Error ? msalError(what, e) : null
	if (msal) {
		return msal
	}
	if (e instanceof AuthenticationError) {
		const { error, errorDescription } = e.errorResponse
		const detail = errorDescription ? firstLine(errorDescription) : error
		return new GraphApiError(
			`Microsoft Graph ${what} failed: ${detail}`,
			e.statusCode,
			error || null,
		)
	}
	if (e instanceof Error) {
		const status =
			'responseStatusCode' in e && typeof e.responseStatusCode === 'number'
				? e.responseStatusCode
				: null
		// ODataError carries Graph's `{ error: { code, message } }` as `errorEscaped`.
		const main =
			'errorEscaped' in e && typeof e.errorEscaped === 'object' && e.errorEscaped !== null
				? (e.errorEscaped as { code?: string | null; message?: string | null })
				: null
		const detail =
			main?.message || main?.code || e.message || (status ? `HTTP ${status}` : e.name)
		return new GraphApiError(
			`Microsoft Graph ${what} failed: ${firstLine(detail)}`,
			status,
			main?.code ?? null,
		)
	}
	return new GraphApiError(`Microsoft Graph ${what} failed: ${String(e)}`, null)
}

/** One page of a collection as the SDK returns it. */
interface Page<T> {
	value?: T[] | null
	odataNextLink?: string | null
}

/** A collection request builder (`api.users`, `api.users.byUserId(id).events`, …). */
interface CollectionRequestBuilder<T, C> {
	get(config?: C): Promise<Page<T> | undefined>
	withUrl(rawUrl: string): CollectionRequestBuilder<T, C>
}

/** One app registration in one Entra tenant. */
export class GraphClient {
	readonly api: GraphServiceClient
	private readonly credential: ClientSecretCredential

	constructor(creds: GraphCredentials) {
		this.credential = credentialOf(creds)
		const auth = new GraphAzureIdentityAuthenticationProvider(this.credential, [SCOPE])
		this.api = createGraphServiceClient(new GraphRequestAdapter(auth))
	}

	/** Access token from MSAL's cache or a new client-credentials request. */
	async token(): Promise<Result<string, Error>> {
		return Result.tryPromise({
			try: async () => {
				const token = await this.credential.getToken(SCOPE)
				if (!token?.token) {
					throw new GraphApiError(
						'Microsoft Graph token request returned no access token',
						null,
					)
				}
				return token.token
			},
			catch: (e: unknown) => toGraphError('token request', e),
		})
	}

	/** Runs one SDK call; `what` names it in error messages. */
	async call<T>(
		what: string,
		fn: (api: GraphServiceClient) => Promise<T>,
	): Promise<Result<T, GraphApiError>> {
		return Result.tryPromise({
			try: () => fn(this.api),
			catch: (e: unknown) => toGraphError(what, e),
		})
	}

	/**
	 * Every item of a collection: follows `@odata.nextLink`. `config` (query
	 * parameters, headers) applies to the first page; next links already carry
	 * the query, later pages only get its headers and options.
	 */
	async getAll<T, C extends { headers?: unknown; options?: unknown }>(
		what: string,
		builder: CollectionRequestBuilder<T, C>,
		config?: C,
	): Promise<Result<T[], GraphApiError>> {
		const items: T[] = []
		let page = await this.call(what, () => builder.get(config))
		for (let n = 1; ; n++) {
			if (Result.isError(page)) {
				return page
			}
			items.push(...(page.value?.value ?? []))
			const next = page.value?.odataNextLink
			if (!next) {
				return Result.ok(items)
			}
			if (n >= MAX_PAGES) {
				return Result.err(
					new GraphApiError(`Microsoft Graph ${what} returned too many pages`, null),
				)
			}
			const rest = { headers: config?.headers, options: config?.options } as C
			page = await this.call(what, () => builder.withUrl(next).get(rest))
		}
	}
}
