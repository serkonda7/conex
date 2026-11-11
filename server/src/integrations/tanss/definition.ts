import { Result } from 'better-result'
import type { IntegrationSecrets } from '../secrets'
import type { IntegrationConfig, IntegrationProvider, ProviderDefinition } from '../types'
import type { TanssCredentials } from './client'
import { TanssProvider } from './provider'

/** Login credentials of the TANSS user API plus the ERP token. */
export function tanssCredentials(
	config: IntegrationConfig,
	secrets: IntegrationSecrets<'tanss'>,
): Result<TanssCredentials, Error> {
	if (config.base_url === null || config.username === null) {
		return Result.err(new Error('TANSS server URL and username are required'))
	}
	return Result.ok({ base_url: config.base_url, username: config.username, ...secrets })
}

export const tanssDefinition: ProviderDefinition<'tanss'> = {
	id: 'tanss',
	capabilities: {
		employees: true,
		tickets: true,
		push: true,
		create_device: true,
		customer_numbers: true,
		tenant_cardinality: 'one',
	},
	incremental: true,
	secretLabels: { password: 'Password', erp_token: 'ERP API token' },
	build(
		config: IntegrationConfig,
		secrets: IntegrationSecrets<'tanss'>,
	): Result<IntegrationProvider, Error> {
		return tanssCredentials(config, secrets).map(
			(creds): IntegrationProvider => new TanssProvider(creds),
		)
	},
}
