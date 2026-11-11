import { Result } from 'better-result'
import { M365SettingsSchema } from 'shared/src/schemas'
import * as v from 'valibot'
import type { IntegrationSecrets } from '../secrets'
import type { IntegrationConfig, IntegrationProvider, ProviderDefinition } from '../types'
import { type M365Credentials, M365Provider } from './provider'
import { deleteAllM365Tenants } from './tenants'

/** Settings and client secret of the MSP's multi-tenant app. */
export function m365Credentials(
	config: IntegrationConfig,
	secrets: IntegrationSecrets<'m365'>,
): Result<M365Credentials, Error> {
	const settings = v.safeParse(M365SettingsSchema, config.settings)
	if (!settings.success) {
		return Result.err(new Error('Microsoft 365 client ID and home tenant are required'))
	}
	return Result.ok({ ...settings.output, client_secret: secrets.client_secret })
}

export const m365Definition: ProviderDefinition<'m365'> = {
	id: 'm365',
	capabilities: {
		employees: true,
		devices: false,
		tickets: false,
		push: false,
		create_device: false,
		customer_numbers: false,
		tenant_cardinality: 'one',
	},
	incremental: false,
	secretLabels: { client_secret: 'Client secret' },
	// No device level yet (Intune is phase 2).
	coversDevice: () => false,
	deleteData: deleteAllM365Tenants,
	build(
		config: IntegrationConfig,
		secrets: IntegrationSecrets<'m365'>,
	): Result<IntegrationProvider, Error> {
		return m365Credentials(config, secrets).map(
			(creds): IntegrationProvider => new M365Provider(creds),
		)
	},
}
