/** Tenant integration status for the tenant page's "Needs attention" list. */
import { Result } from 'better-result'
import type { FindingKind, TenantIntegrationStatus } from 'shared/src/schemas'
import { createResource, type Resource } from 'solid-js'
import {
	fetch_integrations,
	fetch_tenant_integration,
	type IntegrationJson,
} from '../../api/integrations'
import { createRowsFor } from '../../lib/resource'
import { can } from '../../lib/session'

/** Configured, enabled integrations visible to users who can manage them. */
function useIntegrations(): () => IntegrationJson[] {
	const [integrations] = createRowsFor(() => can('integrations.manage'), fetch_integrations)
	return () => (integrations() ?? []).filter((i) => i.enabled)
}

/** Integration status of a tenant, loaded once per configured provider. */
export interface TenantIntegration {
	integration: IntegrationJson
	status: TenantIntegrationStatus | null
	error: string | null
}

/**
 * Status of every enabled integration for the tenant, for the tenant
 * page's "Needs attention" list.
 */
export function useTenantIntegrations(tenantId: () => number): Resource<TenantIntegration[]> {
	const integrations = useIntegrations()
	const [statuses] = createResource(
		() => ({ tenant: tenantId(), list: integrations() }),
		async (q): Promise<TenantIntegration[]> =>
			Promise.all(
				q.list.map(async (integration: IntegrationJson): Promise<TenantIntegration> => {
					const res = await fetch_tenant_integration(integration.provider, q.tenant)
					return Result.isError(res)
						? { integration, status: null, error: res.error.message }
						: { integration, status: res.value, error: null }
				}),
			),
	)
	return statuses
}

/** Integration report of the provider, narrowed to the tenant (and a finding kind). */
export function tenantReportHref(
	integration: IntegrationJson,
	tenantId: number,
	kind?: FindingKind,
): string {
	const base = `/integrations/${integration.id}?tenant=${tenantId}`
	return kind === undefined ? base : `${base}&kind=${kind}`
}
