import type { IntegrationProvider as ProviderId } from 'shared/src/schemas'
import { m365Definition } from './m365/definition'
import { octojaDefinition } from './octoja/definition'
import { OctojaProvider } from './octoja/provider'
import { tanssDefinition } from './tanss/definition'
import { TanssProvider } from './tanss/provider'
import type { IntegrationProvider, ProviderCredentials, ProviderDefinition } from './types'
import { unifiDefinition } from './unifi/definition'
import { UnifiProvider } from './unifi/provider'

/**
 * Every provider by id. Credential-based providers are built by the factory
 * below; the definitions add capabilities and the common build path used by
 * the store (including providers with their own settings/secrets).
 */
const DEFINITIONS: { [P in ProviderId]: ProviderDefinition<P> } = {
	tanss: tanssDefinition,
	octoja: octojaDefinition,
	unifi: unifiDefinition,
	m365: m365Definition,
}

export function providerDefinition<P extends ProviderId>(provider: P): ProviderDefinition<P> {
	return DEFINITIONS[provider]
}

/**
 * Provider factory keyed by provider id. All three credential providers share
 * one credential shape (TANSS uses `erp_token`, Octoja leaves it empty, UniFi
 * stores its API key in `password` and leaves username and `erp_token` empty).
 * M365 has its own settings/secrets and is built through its definition.
 */
export function buildProvider(
	provider: ProviderId,
	creds: ProviderCredentials,
): IntegrationProvider {
	switch (provider) {
		case 'tanss':
			return new TanssProvider(creds)
		case 'octoja':
			return new OctojaProvider(creds)
		case 'unifi':
			return new UnifiProvider(creds)
		case 'm365':
			throw new Error(
				'M365 is built through its provider definition, not the credential factory',
			)
	}
}
