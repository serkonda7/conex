/**
 * Provider differences the integration pages branch on. The shared schemas
 * own the data-model differences (ERP token, employees); these cover the
 * remaining external-system behaviour in one place, so pages never compare
 * raw provider strings.
 */
import type { IntegrationProvider } from 'shared/src/types'

/** Whether the external system accepts devices created/updated from conex. */
export function providerCanWriteDevices(provider: IntegrationProvider): boolean {
	return provider === 'tanss'
}

/** Whether the user signs in with a mail address instead of a username. */
export function providerUsesMailLogin(provider: IntegrationProvider): boolean {
	return provider === 'octoja'
}

/** Whether the external system authenticates with an API key alone (UniFi). */
export function providerUsesApiKey(provider: IntegrationProvider): boolean {
	return provider === 'unifi'
}
