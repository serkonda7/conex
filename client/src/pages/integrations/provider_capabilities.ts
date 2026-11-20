/**
 * Login-form differences between providers. Capabilities (employees, devices,
 * push, create_device, customer_numbers, …) come from
 * `IntegrationJson.capabilities`; this file only covers how the login form
 * differs per provider.
 */
import type { IntegrationProvider } from 'shared/src/types'

/** Whether the user signs in with a mail address instead of a username. */
export function providerUsesMailLogin(provider: IntegrationProvider): boolean {
	return provider === 'octoja'
}

/** Whether the external system authenticates with an API key alone (UniFi). */
export function providerUsesApiKey(provider: IntegrationProvider): boolean {
	return provider === 'unifi'
}
