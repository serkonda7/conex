import type { Result } from 'better-result'
import type {
	EmployeePushField,
	ExternalDeviceJson,
	ExternalEmployeeJson,
	ExternalPushField,
	ExternalTenantJson,
	ExternalTicketJson,
	IntegrationProvider as ProviderId,
} from 'shared/src/schemas'

export type {
	ExternalDeviceJson as ExternalDevice,
	ExternalEmployeeJson as ExternalEmployee,
	ExternalTenantJson as ExternalTenant,
}

/** Ticket as fetched from the external system; the priority is resolved locally. */
export type ExternalTicket = Omit<ExternalTicketJson, 'priority'>

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
	/**
	 * Tenants plus their employees. With `modifiedSince` only records
	 * changed since then (both lists come from one call in TANSS).
	 */
	listTenants(modifiedSince?: number): Promise<Result<ExternalDirectory, Error>>
	fetchDevices(externalTenantId: string): Promise<Result<ExternalDeviceJson[], Error>>
	/** Opens a ticket and returns its external id; absent without a ticket system. */
	createTicket?(input: TicketInput): Promise<Result<number, Error>>
	/** Open tickets of one external tenant; absent without a ticket system. */
	listTickets?(externalTenantId: string): Promise<Result<ExternalTicket[], Error>>
	/** Tags that tickets can carry (priorities map to them by label); absent without tags. */
	listTags?(): Promise<Result<ExternalTag[], Error>>
	/** Creates a device and returns it as fetched by a sync; absent when unsupported. */
	createDevice?(input: DeviceInput): Promise<Result<ExternalDeviceJson, Error>>
	/** Overwrites fields of a device and returns it as fetched by a sync; absent when unsupported. */
	updateDevice?(
		externalId: string,
		changes: DeviceUpdate,
	): Promise<Result<ExternalDeviceJson, Error>>
	/** Overwrites fields of an employee; absent when unsupported. */
	updateEmployee?(externalId: string, changes: EmployeeUpdate): Promise<Result<void, Error>>
}

export interface ExternalDirectory {
	tenants: ExternalTenantJson[]
	/** Empty for providers without employees. */
	employees: ExternalEmployeeJson[]
}

/** Manufacturer is matched by name like on create. */
export type DeviceUpdate = Partial<Record<ExternalPushField, string>>

export type EmployeeUpdate = Partial<Record<EmployeePushField, string>>

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
	/** Contact person who reports the issue. */
	externalEmployeeId?: string
	title: string
	content: string
	/** Priority label (`P<rank> - <name>`), set as the tag of the same name. */
	priority?: string
}

/** Ticket tag of the external system. */
export interface ExternalTag {
	external_id: string
	name: string
}
