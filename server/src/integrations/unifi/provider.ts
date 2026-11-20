/**
 * UniFi Site Manager: tenant ↔ console (host), device ↔ device managed by
 * that console. One conex tenant links to exactly one console. UniFi knows
 * neither employees nor tickets, so only the three read methods are
 * implemented; devices are never written back.
 *
 * The `unifi-api` facades throw `UnifiApiError` on non-2xx (and `fetch` can
 * throw on network errors); every call goes through {@link UnifiProvider.call}
 * so nothing escapes as an exception. One client per provider instance keeps
 * the API key isolated from other integrations.
 */
import { createUnifiClient, type Device, type Host, UnifiApiError } from '@serkonda7/unifi-api'
import type { Result } from 'better-result'
import { externalCall, trimmedText } from '../external_call'
import type {
	ExternalDevice,
	ExternalDirectory,
	ExternalTenant,
	IntegrationProvider,
} from '../types'

/** Credentials for UniFi Site Manager; the API key is the only secret. */
export interface UnifiCredentials {
	base_url: string
	api_key: string
}

/** `reportedState` is opaque in the API, but usually carries a name or hostname. */
function reportedName(reportedState: unknown): string | null {
	if (typeof reportedState !== 'object' || reportedState === null) {
		return null
	}
	const record = reportedState as Record<string, unknown>
	return (
		trimmedText(typeof record.name === 'string' ? record.name : undefined) ??
		trimmedText(typeof record.hostname === 'string' ? record.hostname : undefined)
	)
}

/** Turns a thrown facade error into a readable message, never rethrowing. */
function failure(what: string, error: unknown): Error {
	if (error instanceof UnifiApiError) {
		if (error.status === 401 || error.status === 403) {
			return new Error(`UniFi ${what} failed: invalid API key or missing permission`)
		}
		if (error.status === 429) {
			const retry =
				error.retryAfter === undefined ? '' : ` Retry after ${error.retryAfter} seconds.`
			return new Error(`UniFi ${what} failed (HTTP 429): rate limited.${retry}`)
		}
		return new Error(
			`UniFi ${what} failed (HTTP ${error.status ?? 'unknown'}): ${error.message}`,
		)
	}
	return new Error(
		`UniFi ${what} failed: ${error instanceof Error ? error.message : String(error)}`,
	)
}

/** Consoles without an id cannot be linked and are skipped. */
export function toTenant(host: Host): ExternalTenant | null {
	const id = trimmedText(host.id)
	if (id === null) {
		return null
	}
	return {
		external_id: id,
		display_id: null,
		name: reportedName(host.reportedState) ?? trimmedText(host.ipAddress) ?? id,
		active: host.isBlocked !== true,
		private: false,
		headquarter_id: null,
	}
}

/** Only called for devices with an id; the `device:` prefix keeps ids unambiguous like TANSS's `pc:`. */
export function toDevice(device: Device, externalTenantId: string): ExternalDevice {
	const id = trimmedText(device.id)
	const mac = trimmedText(device.mac)
	const ip = trimmedText(device.ip)
	return {
		external_id: `device:${id}`,
		external_tenant_id: externalTenantId,
		kind: trimmedText(device.productLine) ?? 'network',
		name: trimmedText(device.name) ?? trimmedText(device.model) ?? mac ?? id ?? '',
		serial: null,
		asset_tag: null,
		manufacturer: 'Ubiquiti',
		model: trimmedText(device.model) ?? trimmedText(device.shortname),
		macs: mac === null ? [] : [mac],
		ips: ip === null ? [] : [ip],
		active: true,
	}
}

export class UnifiProvider implements IntegrationProvider {
	readonly id = 'unifi' as const
	private readonly unifi: ReturnType<typeof createUnifiClient>

	constructor(creds: UnifiCredentials) {
		this.unifi = createUnifiClient({ apiKey: creds.api_key, baseUrl: creds.base_url })
	}

	/** Single network choke point: offline guard and no throws. */
	private async call<T>(
		what: string,
		run: () => Promise<T>,
		mapError: (error: unknown) => Error = (error: unknown): Error => failure(what, error),
	): Promise<Result<T, Error>> {
		return externalCall('UniFi', run, mapError)
	}

	/** One cheap request is enough to check the key and its permission. */
	async verify(): Promise<Result<void, Error>> {
		const hosts = await this.call('host list', () => this.unifi.hosts.list({ pageSize: 1 }))
		return hosts.map(() => undefined)
	}

	/** Hosts are a complete list; Site Manager has no `modifiedSince` delta. */
	async listTenants(_modifiedSince?: number): Promise<Result<ExternalDirectory, Error>> {
		const hosts = await this.call('host list', () => this.unifi.hosts.listAll())
		return hosts.map((rows) => ({
			tenants: rows
				.map(toTenant)
				.filter((tenant): tenant is ExternalTenant => tenant !== null),
			employees: [],
		}))
	}

	async fetchDevices(externalTenantId: string): Promise<Result<ExternalDevice[], Error>> {
		const groups = await this.call('device list', () =>
			this.unifi.devices.listAll({ hostIds: [externalTenantId] }),
		)
		return groups.map((rows) =>
			rows.flatMap((group) => {
				const devices: ExternalDevice[] = []
				for (const device of group.devices ?? []) {
					if (device === null || trimmedText(device.id) === null) {
						continue
					}
					devices.push(toDevice(device, externalTenantId))
				}
				return devices
			}),
		)
	}
}
