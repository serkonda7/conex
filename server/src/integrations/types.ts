import type { Result } from 'better-result'
import type {
	ExternalDeviceJson,
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
}
