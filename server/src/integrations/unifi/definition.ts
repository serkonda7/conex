import { Result } from 'better-result'
import type { IntegrationSecrets } from '../secrets'
import type { IntegrationConfig, IntegrationProvider, ProviderDefinition } from '../types'
import { UnifiProvider } from './provider'

/** UniFi Site Manager: one console per conex site, devices only. */
export const unifiDefinition: ProviderDefinition<'unifi'> = {
	id: 'unifi',
	capabilities: {
		employees: false,
		devices: true,
		tickets: false,
		push: false,
		device_push: ['name'],
		device_pull: ['serial'],
		create_device: false,
		customer_numbers: false,
		link_level: 'site',
	},
	incremental: false,
	secretLabels: { password: 'API key' },
	coversDevice: (device: { manufacturer: string }) =>
		device.manufacturer.toLowerCase() === 'ubiquiti',
	build(
		config: IntegrationConfig,
		secrets: IntegrationSecrets<'unifi'>,
	): Result<IntegrationProvider, Error> {
		if (config.base_url === null) {
			return Result.err(new Error('UniFi Site Manager URL is required'))
		}
		return Result.ok(
			new UnifiProvider({
				base_url: config.base_url,
				api_key: secrets.password,
			}),
		)
	},
}
