import type { Result } from 'better-result'
import type {
	ExternalDeviceJson,
	ExternalPushField,
	ExternalTenantJson,
	IntegrationProvider as ProviderId,
} from 'shared/src/schemas'

export type { ExternalDeviceJson as ExternalDevice, ExternalTenantJson as ExternalTenant }

/**
 * One external system mapped onto normalized records, so linking, matching
 * and the consistency report are written once for every provider.
 * Methods return `Result`; HTTP/auth failures never throw.
 */
export interface IntegrationProvider {
	id: ProviderId
	/** TANSS: one company per tenant; UniFi (later): many sites per tenant. */
	tenantCardinality: 'one' | 'many'
	/** Logs in with every stored credential; used before saving. */
	verify(): Promise<Result<void, Error>>
	listTenants(modifiedSince?: number): Promise<Result<ExternalTenantJson[], Error>>
	fetchDevices(externalTenantId: string): Promise<Result<ExternalDeviceJson[], Error>>
	/** Opens a ticket and returns its external id; absent without a ticket system. */
	createTicket?(input: TicketInput): Promise<Result<number, Error>>
	/** Creates a device and returns it as fetched by a sync; absent when unsupported. */
	createDevice?(input: DeviceInput): Promise<Result<ExternalDeviceJson, Error>>
	/** Overwrites fields of a device and returns it as fetched by a sync; absent when unsupported. */
	updateDevice?(
		externalId: string,
		changes: DeviceUpdate,
	): Promise<Result<ExternalDeviceJson, Error>>
}

/** Manufacturer is matched by name like on create. */
export type DeviceUpdate = Partial<Record<ExternalPushField, string>>

export interface DeviceInput {
	externalTenantId: string
	name: string
	serial: string | null
	asset_tag: string | null
	/** Matched by name; omitted when the external system does not know it. */
	manufacturer: string | null
	model: string | null
	/** Device role is the built-in `server` role. */
	server: boolean
	active: boolean
}

export interface TicketInput {
	externalTenantId: string
	externalDeviceId?: string
	title: string
	content: string
}
