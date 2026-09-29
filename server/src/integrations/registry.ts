import type { IntegrationProvider as ProviderId } from 'shared/src/schemas'
import type { TanssCredentials } from './tanss/client'
import { TanssProvider } from './tanss/provider'
import type { IntegrationProvider } from './types'

/**
 * Provider factory keyed by provider id. UniFi and servereye plug in here
 * with their own credential shapes once they exist.
 */
export function buildProvider(provider: ProviderId, creds: TanssCredentials): IntegrationProvider {
	switch (provider) {
		case 'tanss':
			return new TanssProvider(creds)
	}
}
