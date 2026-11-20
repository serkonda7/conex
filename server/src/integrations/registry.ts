import type { IntegrationProvider as ProviderId } from 'shared/src/schemas'
import { OctojaProvider } from './octoja/provider'
import { TanssProvider } from './tanss/provider'
import type { IntegrationProvider, ProviderCredentials } from './types'
import { UnifiProvider } from './unifi/provider'

/**
 * Provider factory keyed by provider id. All providers share one credential
 * shape (TANSS uses `erp_token`, Octoja leaves it empty, UniFi stores its API
 * key in `password` and leaves username and `erp_token` empty).
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
	}
}
