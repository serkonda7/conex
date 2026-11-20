/**
 * Octoja RMM: tenant ↔ customer, device ↔ asset. Octoja knows neither
 * employees nor tickets, so only the three read methods are implemented.
 *
 * The `octoja-api` facades throw on non-2xx (and `fetch` can throw on network
 * errors); every call goes through {@link OctojaProvider.call} so nothing
 * escapes as an exception. One client per provider instance keeps the login
 * token isolated from other integrations.
 */
import { Result } from 'better-result'
import {
	type AssetHeaderResponse,
	type Customer,
	createOctojaClient,
	OctojaApiError,
} from 'octoja-api'
import { ensureIntegrationsLive } from '../../config'
import type {
	ExternalDevice,
	ExternalDirectory,
	ExternalTenant,
	IntegrationProvider,
	ProviderCredentials,
} from '../types'

/** `GET /api/assets` clamps at 500 per Octoja's API docs; 200 is safe. */
const PAGE_SIZE = 200

function text(value: string | null | undefined): string | null {
	const trimmed = value?.trim() ?? ''
	return trimmed === '' ? null : trimmed
}

/** Reads the reason out of Octoja's RFC 7807 `ProblemDetails` error body. */
function reason(body: unknown): string | null {
	if (typeof body === 'string') {
		return text(body)
	}
	if (typeof body !== 'object' || body === null) {
		return null
	}
	const record = body as Record<string, unknown>
	for (const key of ['detail', 'title', 'message']) {
		const raw = record[key]
		if (typeof raw !== 'string') {
			continue
		}
		const value = text(raw)
		if (value !== null) {
			return value
		}
	}
	return null
}

/** Turns a thrown facade error into a readable message, never rethrowing. */
function failure(what: string, error: unknown): Error {
	if (error instanceof OctojaApiError) {
		const status = error.status === undefined ? '' : ` (HTTP ${error.status})`
		return new Error(`Octoja ${what} failed${status}: ${reason(error.body) ?? error.message}`)
	}
	return new Error(
		`Octoja ${what} failed: ${error instanceof Error ? error.message : String(error)}`,
	)
}

/** Customers without an id cannot be linked and are skipped. */
export function toTenant(customer: Customer): ExternalTenant | null {
	const id = text(customer.id)
	if (id === null) {
		return null
	}
	return {
		external_id: id,
		display_id: customer.externalReference ?? null,
		name: text(customer.name) ?? id,
		active: true,
		private: false,
		headquarter_id: null,
	}
}

/** `id` is a uuid, so the TANSS-style type prefix keeps ids unambiguous. */
export function toDevice(asset: AssetHeaderResponse, externalTenantId: string): ExternalDevice {
	const ip = text(asset.ipAddress)
	return {
		external_id: `asset:${asset.id}`,
		external_tenant_id: externalTenantId,
		kind: asset.deviceKind,
		name: text(asset.displayName) ?? text(asset.deviceName) ?? asset.id,
		serial: text(asset.serialNumber),
		asset_tag: null,
		manufacturer: text(asset.manufacturer),
		model: text(asset.model),
		macs: [],
		ips: ip === null ? [] : [ip],
		active: true,
	}
}

export class OctojaProvider implements IntegrationProvider {
	readonly id = 'octoja' as const
	readonly tenantCardinality = 'one' as const
	private readonly octoja: ReturnType<typeof createOctojaClient>
	private loginPromise: Promise<Result<void, Error>> | null = null

	constructor(private readonly creds: ProviderCredentials) {
		this.octoja = createOctojaClient({ baseUrl: creds.base_url })
	}

	/** Single network choke point: offline guard and no throws. */
	private async call<T>(
		what: string,
		run: () => Promise<T>,
		mapError: (error: unknown) => Error = (error: unknown): Error => failure(what, error),
	): Promise<Result<T, Error>> {
		const live = ensureIntegrationsLive('Octoja')
		if (Result.isError(live)) {
			return live
		}
		return Result.tryPromise({ try: run, catch: mapError })
	}

	/** Logs in once per provider instance; the facade stores the token. TOTP is unsupported. */
	private login(): Promise<Result<void, Error>> {
		if (this.loginPromise === null) {
			this.loginPromise = this.call(
				'login',
				() =>
					this.octoja.auth.login({
						mailAddress: this.creds.username,
						password: this.creds.password,
					}),
				(error: unknown) =>
					error instanceof OctojaApiError && error.status === 401
						? new Error('Octoja login failed: invalid mail address or password')
						: failure('login', error),
			).then((res) => res.map(() => undefined))
		}
		return this.loginPromise
	}

	async verify(): Promise<Result<void, Error>> {
		return this.login()
	}

	/** Customers are a complete list; Octoja has no `modifiedSince` delta. */
	async listTenants(_modifiedSince?: number): Promise<Result<ExternalDirectory, Error>> {
		const login = await this.login()
		if (Result.isError(login)) {
			return login
		}
		const customers = await this.call('customer list', () => this.octoja.customers.list())
		return customers.map((rows) => ({
			tenants: rows
				.map(toTenant)
				.filter((tenant): tenant is ExternalTenant => tenant !== null),
			employees: [],
		}))
	}

	/**
	 * `page` is 1-based (Octoja API docs). Stop at `total`; a short/empty page
	 * is only the fallback when no usable total is returned, so a clamped
	 * `pageSize` cannot cut the list short.
	 */
	async fetchDevices(externalTenantId: string): Promise<Result<ExternalDevice[], Error>> {
		const login = await this.login()
		if (Result.isError(login)) {
			return login
		}
		const devices: ExternalDevice[] = []
		for (let page = 1; ; page++) {
			const listed = await this.call(`asset list (page ${page})`, () =>
				this.octoja.assets.list({
					customerId: externalTenantId,
					page,
					pageSize: PAGE_SIZE,
				}),
			)
			if (Result.isError(listed)) {
				return listed
			}
			const { items, total } = listed.value
			devices.push(...items.map((asset) => toDevice(asset, externalTenantId)))
			const expected = Number(total)
			const exhausted = Number.isFinite(expected)
				? devices.length >= expected
				: items.length < PAGE_SIZE
			if (items.length === 0 || exhausted) {
				break
			}
		}
		return Result.ok(devices)
	}
}
