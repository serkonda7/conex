/**
 * Thin `tanss-api` wrapper: every call returns a `Result`, nothing throws.
 *
 * Two credentials, two isolated client instances (never the shared
 * `client` singleton, so no auth state leaks between integrations):
 * - user API (`/api/v1/...`, PCs and manufacturers): JWT from
 *   `POST /api/v1/login`, valid ~4 h with a 2 min idle timeout. A session
 *   logs in lazily and re-logs in once on 401.
 * - ERP API (`/api/erp/v1/...`, company list): the ERP role token.
 * Both are sent verbatim in the `apiToken` header (already `Bearer ...`);
 * `createErpClient(...).instance` is an isolated hey-api client with exactly
 * that auth, so it is reused for the user API with the login JWT.
 */

import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { Result } from 'better-result'
import {
	createErpClient,
	getApiV1Manufacturers,
	postApiV1Login,
	putApiV1Pcs,
	type TnsPersonalComputerWithDetails,
} from 'tanss-api'
import * as v from 'valibot'

export interface TanssCredentials {
	base_url: string
	username: string
	password: string
	erp_token: string
}

/** Company row of the ERP customer list (raw TANSS field names). */
export interface TanssCompany {
	id: number
	name: string
	displayId: string | null
	inactive: boolean
	lockout: boolean
	/** Private person, not a business customer. */
	private: boolean
	headquarterId: number | null
}

export type TanssPc = TnsPersonalComputerWithDetails

/** Raised for HTTP failures; `status` 401/403 means bad credentials. */
export class TanssApiError extends Error {
	constructor(
		message: string,
		readonly status: number | null,
	) {
		super(message)
		this.name = 'TanssApiError'
	}
}

interface HeyApiResult {
	data?: unknown
	error?: unknown
	response?: Response
}

const LoginResponseSchema = v.object({
	content: v.object({ apiKey: v.pipe(v.string(), v.minLength(1)) }),
})

const ContentListSchema = v.object({ content: v.optional(v.nullable(v.array(v.unknown()))) })

/** Saves successful, unmodified API response bodies outside the database. */
async function saveRawResponse(endpoint: string, payload: unknown): Promise<Result<void, Error>> {
	const outputDir = resolve(process.env.CONEX_TANSS_DUMP_DIR ?? 'data/inegrations')
	const timestamp = new Date().toISOString().replaceAll(':', '-')
	const filename = `${timestamp}-${endpoint}-${randomUUID()}.json`
	const saved = await Result.tryPromise({
		try: async () => {
			await mkdir(outputDir, { recursive: true, mode: 0o700 })
			await writeFile(
				resolve(outputDir, filename),
				`${JSON.stringify(payload, null, 2) ?? 'null'}\n`,
				{
					encoding: 'utf8',
					mode: 0o600,
				},
			)
		},
		catch: (e: unknown) =>
			new Error(
				`Failed to save TANSS ${endpoint} response: ${e instanceof Error ? e.message : String(e)}`,
			),
	})
	return saved.map(() => undefined)
}

/** TANSS answers errors as `{ error: { text } }` or `{ meta: { text } }`. */
function errorText(error: unknown): string | null {
	if (typeof error !== 'object' || error === null) {
		return typeof error === 'string' && error !== '' ? error : null
	}
	const record = error as Record<string, unknown>
	for (const key of ['error', 'meta']) {
		const nested = record[key]
		if (typeof nested === 'object' && nested !== null) {
			const text = (nested as Record<string, unknown>).text
			if (typeof text === 'string' && text !== '') {
				return text
			}
		}
	}
	return typeof record.message === 'string' ? record.message : null
}

async function call(
	what: string,
	run: () => Promise<HeyApiResult>,
): Promise<Result<unknown, Error>> {
	const res = await Result.tryPromise({
		try: run,
		catch: (e: unknown) =>
			new TanssApiError(
				`TANSS ${what} failed: ${e instanceof Error ? e.message : String(e)}`,
				null,
			),
	})
	if (Result.isError(res)) {
		return res
	}
	const { data, error, response } = res.value
	const status = response?.status ?? null
	if (error !== undefined || (status !== null && status >= 400)) {
		const detail = errorText(error) ?? (status !== null ? `HTTP ${status}` : 'no response')
		return Result.err(new TanssApiError(`TANSS ${what} failed: ${detail}`, status))
	}
	return Result.ok(data)
}

function instanceFor(baseUrl: string, token: string): ReturnType<typeof createErpClient> {
	return createErpClient({ baseUrl, token })
}

/** Logs in a TANSS user and returns the `Bearer ...` API key. */
export async function tanssLogin(
	baseUrl: string,
	username: string,
	password: string,
): Promise<Result<string, Error>> {
	const client = instanceFor(baseUrl, '').instance
	const res = await call('login', () => postApiV1Login({ client, body: { username, password } }))
	if (Result.isError(res)) {
		return res
	}
	const parsed = v.safeParse(LoginResponseSchema, res.value)
	if (!parsed.success) {
		// Accounts with two-factor auth answer without an API key until a
		// token is supplied; unattended syncs cannot do that.
		return Result.err(
			new TanssApiError(
				'TANSS login returned no API key (two-factor auth enabled for this user?)',
				null,
			),
		)
	}
	return Result.ok(parsed.output.content.apiKey)
}

function str(value: unknown): string | null {
	if (typeof value === 'string') {
		return value.trim() === '' ? null : value.trim()
	}
	if (typeof value === 'number') {
		return String(value)
	}
	return null
}

function num(value: unknown): number | null {
	if (typeof value === 'number' && Number.isInteger(value)) {
		return value
	}
	if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
		return Number(value.trim())
	}
	return null
}

/** Customer category that marks suppliers; they are never tenants. */
const SUPPLIER_CATEGORY = 'Lieferant'

/** `categories: [{ id, name, section }]` contains the supplier category. */
function isSupplier(categories: unknown): boolean {
	return (
		Array.isArray(categories) &&
		categories.some(
			(c: unknown) =>
				typeof c === 'object' &&
				c !== null &&
				str((c as { name?: unknown }).name) === SUPPLIER_CATEGORY,
		)
	)
}

/**
 * The ERP customer list is untyped in the OpenAPI spec. Real installations
 * answer `{ customers: [{ id, customer_number, name, headquarters, active,
 * … }], employees: [...] }`; the `CompanyDetail` field names are accepted as
 * well. Rows without id or name are skipped, as are suppliers (see
 * `isSupplier`).
 */
function toCompany(raw: unknown): TanssCompany | null {
	if (typeof raw !== 'object' || raw === null) {
		return null
	}
	const r = raw as Record<string, unknown>
	const id = num(r.id ?? r.companyId)
	const name = str(r.name ?? r.companyName)
	if (id === null || name === null || isSupplier(r.categories)) {
		return null
	}
	return {
		id,
		name,
		displayId: str(r.customer_number ?? r.displayId ?? r.customerNumber ?? r.number),
		inactive: r.inactive === true || r.active === false,
		lockout: r.lockout === true,
		private: r.private === true,
		headquarterId: num(r.headquarters ?? r.headquarterId),
	}
}

/** Rows of the ERP customer list: `customers`, else a generic list. */
function customerRows(data: unknown): unknown[] {
	const customers = (data as { customers?: unknown } | null)?.customers
	return Array.isArray(customers) ? customers : listContent(data)
}

function listContent(data: unknown): unknown[] {
	if (Array.isArray(data)) {
		return data
	}
	const parsed = v.safeParse(ContentListSchema, data)
	if (parsed.success) {
		return parsed.output.content ?? []
	}
	const content = (data as { content?: unknown } | null)?.content
	if (typeof content === 'object' && content !== null) {
		// Some ERP endpoints wrap lists one level deeper.
		for (const value of Object.values(content)) {
			if (Array.isArray(value)) {
				return value
			}
		}
	}
	return []
}

/** One authenticated TANSS connection (one sync run or one check). */
export class TanssSession {
	private apiKey: string | null = null
	private readonly erp: ReturnType<typeof createErpClient>

	constructor(private readonly creds: TanssCredentials) {
		this.erp = instanceFor(creds.base_url, creds.erp_token)
	}

	async login(): Promise<Result<void, Error>> {
		const res = await tanssLogin(this.creds.base_url, this.creds.username, this.creds.password)
		if (Result.isError(res)) {
			return res
		}
		this.apiKey = res.value
		return Result.ok(undefined)
	}

	/** User-API call with lazy login and one re-login on 401. */
	private async userCall(
		what: string,
		run: (client: ReturnType<typeof createErpClient>['instance']) => Promise<HeyApiResult>,
	): Promise<Result<unknown, Error>> {
		for (let attempt = 0; attempt < 2; attempt++) {
			if (this.apiKey === null) {
				const login = await this.login()
				if (Result.isError(login)) {
					return login
				}
			}
			const client = instanceFor(this.creds.base_url, this.apiKey ?? '').instance
			const res = await call(what, () => run(client))
			if (
				Result.isError(res) &&
				res.error instanceof TanssApiError &&
				res.error.status === 401 &&
				attempt === 0
			) {
				this.apiKey = null
				continue
			}
			return res
		}
		return Result.err(new TanssApiError(`TANSS ${what} failed: unauthorized`, 401))
	}

	/** All companies on the first sync; changed companies on later syncs. */
	async listCompanies(modifiedSince?: number): Promise<Result<TanssCompany[], Error>> {
		const res = await call('customer list', async () => ({
			data:
				modifiedSince === undefined
					? await this.erp.customers.listAll()
					: await this.erp.customers.listModified(modifiedSince),
		}))
		if (Result.isError(res)) {
			return res
		}
		const dump = await saveRawResponse(
			modifiedSince === undefined
				? 'customers-listAll'
				: `customers-listModified-${modifiedSince}`,
			res.value,
		)
		if (Result.isError(dump)) {
			return dump
		}
		const companies: TanssCompany[] = []
		for (const raw of customerRows(res.value)) {
			const company = toCompany(raw)
			if (company) {
				companies.push(company)
			}
		}
		return Result.ok(companies)
	}

	/** PCs of exactly one company (branches are their own tenants). */
	async listPcs(companyId: number): Promise<Result<TanssPc[], Error>> {
		const res = await this.userCall('PC list', (client) =>
			putApiV1Pcs({
				client,
				body: { companyId, branches: 'COMPANY_ONLY', active: 'ACTIVE_AND_INACTIVE' },
			}),
		)
		if (Result.isError(res)) {
			return res
		}
		const dump = await saveRawResponse(`pcs-company-${companyId}`, res.value)
		if (Result.isError(dump)) {
			return dump
		}
		return res.map((data) => listContent(data) as TanssPc[])
	}

	/** Manufacturer id → name. */
	async manufacturerNames(): Promise<Result<Map<number, string>, Error>> {
		const res = await this.userCall('manufacturer list', (client) =>
			getApiV1Manufacturers({ client }),
		)
		if (Result.isError(res)) {
			return res
		}
		const dump = await saveRawResponse('manufacturers', res.value)
		if (Result.isError(dump)) {
			return dump
		}
		return res.map((data) => {
			const names = new Map<number, string>()
			for (const raw of listContent(data)) {
				const row = raw as { id?: unknown; name?: unknown }
				const id = num(row.id)
				const name = str(row.name)
				if (id !== null && name !== null) {
					names.set(id, name)
				}
			}
			return names
		})
	}
}
