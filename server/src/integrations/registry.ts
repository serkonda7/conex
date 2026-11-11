import type { IntegrationProvider as ProviderId } from 'shared/src/schemas'
import { tanssDefinition } from './tanss/definition'
import type { ProviderDefinition } from './types'

/**
 * Every provider by id. UniFi and Microsoft 365 plug in here with a
 * definition of their own (credentials, capabilities, report hooks).
 */
const DEFINITIONS: { [P in ProviderId]: ProviderDefinition<P> } = {
	tanss: tanssDefinition,
}

export function providerDefinition<P extends ProviderId>(provider: P): ProviderDefinition<P> {
	return DEFINITIONS[provider]
}
