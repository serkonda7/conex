import type { IntegrationProvider as ProviderId } from 'shared/src/schemas'
import { m365Definition } from './m365/definition'
import { tanssDefinition } from './tanss/definition'
import type { ProviderDefinition } from './types'

/**
 * Every provider by id. UniFi plugs in here with a
 * definition of their own (credentials, capabilities, report hooks).
 */
const DEFINITIONS: { [P in ProviderId]: ProviderDefinition<P> } = {
	tanss: tanssDefinition,
	m365: m365Definition,
}

export function providerDefinition<P extends ProviderId>(provider: P): ProviderDefinition<P> {
	return DEFINITIONS[provider]
}
