import type { IntegrationProvider as ProviderId } from 'shared/src/schemas'
import { OctojaProvider } from './octoja/provider'
import { TanssProvider } from './tanss/provider'
import type { IntegrationProvider, ProviderCredentials } from './types'

/**
 * Provider factory keyed by provider id. Both providers share one credential
 * shape for now (Octoja leaves `erp_token` empty); further ones (UniFi,
 * servereye, …) plug in here with their own credential shapes once they exist.
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
	}
}
