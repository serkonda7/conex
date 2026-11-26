import { Result } from 'better-result'
import { EXTERNAL_PUSH_FIELDS } from 'shared/src/schemas'
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
		devices: true,
		tickets: true,
		push: true,
		device_push: EXTERNAL_PUSH_FIELDS,
		device_pull: [],
		create_device: true,
		customer_numbers: true,
		link_level: 'tenant',
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
