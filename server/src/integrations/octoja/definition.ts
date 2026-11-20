import { Result } from 'better-result'
import type { IntegrationSecrets } from '../secrets'
import type { IntegrationConfig, IntegrationProvider, ProviderDefinition } from '../types'
import { OctojaProvider } from './provider'

/** Octoja is read-only in this MVP: customers and their devices. */
export const octojaDefinition: ProviderDefinition<'octoja'> = {
	id: 'octoja',
	capabilities: {
		employees: false,
		devices: true,
		tickets: false,
		push: false,
		create_device: false,
		customer_numbers: true,
		tenant_cardinality: 'one',
	},
	incremental: false,
	secretLabels: { password: 'Password' },
	build(
		config: IntegrationConfig,
		secrets: IntegrationSecrets<'octoja'>,
	): Result<IntegrationProvider, Error> {
		if (config.base_url === null) {
			return Result.err(new Error('Octoja server URL is required'))
		}
		return Result.ok(
			new OctojaProvider({
				base_url: config.base_url,
				mail_address: config.username ?? '',
				password: secrets.password,
			}),
		)
	},
}
