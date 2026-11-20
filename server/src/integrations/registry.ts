import type { IntegrationProvider as ProviderId } from 'shared/src/schemas'
import { m365Definition } from './m365/definition'
import { octojaDefinition } from './octoja/definition'
import { tanssDefinition } from './tanss/definition'
import type { ProviderDefinition } from './types'
import { unifiDefinition } from './unifi/definition'

/** Maps every provider id to its definition. */
const DEFINITIONS: { [P in ProviderId]: ProviderDefinition<P> } = {
	tanss: tanssDefinition,
	octoja: octojaDefinition,
	unifi: unifiDefinition,
	m365: m365Definition,
}

export function providerDefinition<P extends ProviderId>(provider: P): ProviderDefinition<P> {
	return DEFINITIONS[provider]
}
