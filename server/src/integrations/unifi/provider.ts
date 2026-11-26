/**
 * UniFi Site Manager: site ↔ console (host), device ↔ device managed by
 * that console. One conex site links to exactly one console (the console is
 * the "external tenant" of the snapshot), so a tenant has one per site. UniFi knows
 * neither employees nor tickets. The Site Manager API itself is read-only:
 * renaming a device goes through the cloud connector to the legacy Network
 * API on its console. Ubiquiti prints the MAC address as the serial number,
 * so the serial is derived from it.
 *
 * The `unifi-api` facades throw `UnifiApiError` on non-2xx (and `fetch` can
 * throw on network errors); every call goes through {@link UnifiProvider.call}
 * so nothing escapes as an exception. One client per provider instance keeps
 * the API key isolated from other integrations.
 */
import { createUnifiClient, type Device, type Host, UnifiApiError } from '@serkonda7/unifi-api'
import { Result } from 'better-result'
import { externalCall, trimmedText } from '../external_call'
import type {
	DeviceUpdate,
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

/** Ubiquiti's serial number is the MAC address in upper-case hex without separators. */
export function serialFromMac(mac: string | null): string | null {
	const hex = (mac ?? '').replace(/[^0-9a-f]/gi, '').toUpperCase()
	return hex.length === 12 ? hex : null
}

/** MAC address as the legacy Network API expects it (`aa:bb:cc:dd:ee:ff`). */
function legacyMac(mac: string | null): string | null {
	const hex = serialFromMac(mac)?.toLowerCase()
	return hex === undefined || hex === null ? null : (hex.match(/../g) ?? []).join(':')
}

/** Response envelope of the legacy Network API (`/api/s/{site}/...`). */
interface LegacyResponse<T> {
	meta?: { rc?: string; msg?: string }
	data?: T[]
}

/** `data` of a legacy response, or its error message. */
function legacyData<T>(what: string, res: LegacyResponse<T>): Result<T[], Error> {
	if (res.meta?.rc !== undefined && res.meta.rc !== 'ok') {
		return Result.err(new Error(`UniFi ${what} failed: ${res.meta.msg ?? res.meta.rc}`))
	}
	return Result.ok(res.data ?? [])
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
		serial: serialFromMac(mac),
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

	/** Devices of one console in Site Manager form (with id), for mapping and lookups. */
	private async consoleDevices(externalTenantId: string): Promise<Result<Device[], Error>> {
		const groups = await this.call('device list', () =>
			this.unifi.devices.listAll({ hostIds: [externalTenantId] }),
		)
		return groups.map((rows) =>
			rows.flatMap((group) =>
				(group.devices ?? []).filter(
					(device): device is Device =>
						device !== null && trimmedText(device.id) !== null,
				),
			),
		)
	}

	async fetchDevices(externalTenantId: string): Promise<Result<ExternalDevice[], Error>> {
		const devices = await this.consoleDevices(externalTenantId)
		return devices.map((rows) => rows.map((device) => toDevice(device, externalTenantId)))
	}

	/**
	 * Renames a device on its console: the legacy Network API is the only one
	 * that writes device settings. The device is looked up by MAC in every
	 * site of the console, since Site Manager does not say which one it is in.
	 */
	async updateDevice(
		externalId: string,
		changes: DeviceUpdate,
		externalTenantId: string,
	): Promise<Result<ExternalDevice, Error>> {
		if (changes.manufacturer !== undefined || changes.model !== undefined) {
			return Result.err(new Error('UniFi devices can only be renamed'))
		}
		const devices = await this.consoleDevices(externalTenantId)
		if (Result.isError(devices)) {
			return devices
		}
		const device = devices.value.find((d) => `device:${trimmedText(d.id)}` === externalId)
		if (!device) {
			return Result.err(new Error('UniFi device not found on its console'))
		}
		const name = changes.name
		if (name === undefined) {
			return Result.ok(toDevice(device, externalTenantId))
		}
		const mac = legacyMac(trimmedText(device.mac))
		if (mac === null) {
			return Result.err(new Error('UniFi device has no MAC address'))
		}
		const network = this.unifi.connector.forConsole(externalTenantId, 'network/api')
		const sites = await this.call('site list', () =>
			network.get<LegacyResponse<{ name?: string }>>('/self/sites'),
		)
		const siteNames = sites
			.andThen((res) => legacyData('site list', res))
			.map((rows) => rows.flatMap((site) => trimmedText(site.name) ?? []))
		if (Result.isError(siteNames)) {
			return siteNames
		}
		for (const site of siteNames.value) {
			const found = await this.call('device lookup', () =>
				network.get<LegacyResponse<{ _id?: string }>>(`/s/${site}/stat/device/${mac}`),
			)
			const rows = found.andThen((res) => legacyData('device lookup', res))
			if (Result.isError(rows)) {
				return rows
			}
			const id = trimmedText(rows.value[0]?._id)
			if (id === null) {
				continue
			}
			const updated = await this.call('device rename', () =>
				network.put<LegacyResponse<unknown>>(`/s/${site}/rest/device/${id}`, { name }),
			)
			const saved = updated.andThen((res) => legacyData('device rename', res))
			if (Result.isError(saved)) {
				return saved
			}
			// Site Manager reports the new name only after the console syncs it.
			return Result.ok({ ...toDevice(device, externalTenantId), name })
		}
		return Result.err(new Error('UniFi device not found in any site of its console'))
	}
}
