/**
 * Integrations API wrappers (TANSS; more providers later): configuration,
 * sync runs, links and the consistency report. Errors surface as
 * `Result.err` with the server's `{ error }` message.
 */
import { Result } from 'better-result'
import type {
	DeviceIntegrationStatus,
	ExternalLinkJson,
	ExternalTenantListItem,
	IntegrationCreate,
	IntegrationJson,
	IntegrationProvider,
	IntegrationReport,
	IntegrationTest,
	IntegrationUpdate,
	LinkEntityType,
	SyncRunJson,
	TenantIntegrationStatus,
} from 'shared/src/types'
import { client, to_query, to_result } from './api'
import { t, tp } from './i18n'

export type {
	DeviceIntegrationStatus,
	ExternalLinkJson,
	ExternalTenantListItem,
	IntegrationJson,
	IntegrationProvider,
	IntegrationReport,
	SyncRunJson,
	TenantIntegrationStatus,
}

const noun = (): string => tp('noun.integration', 1)

export async function fetch_integrations(): Promise<Result<IntegrationJson[], Error>> {
	const res = await client.integrations.$get()
	return to_result<IntegrationJson[]>(
		res,
		tp('api.loadFailed', 2, { noun: tp('noun.integration', 2) }),
	)
}

export async function create_integration(
	input: IntegrationCreate,
): Promise<Result<IntegrationJson, Error>> {
	const res = await client.integrations.$post({ json: input })
	return to_result<IntegrationJson>(res, t('api.createFailed', { noun: noun() }))
}

export async function update_integration(
	provider: IntegrationProvider,
	patch: IntegrationUpdate,
): Promise<Result<IntegrationJson, Error>> {
	const res = await client.integrations[':provider'].$patch({ param: { provider }, json: patch })
	return to_result<IntegrationJson>(res, t('api.updateFailed', { noun: noun() }))
}

export async function delete_integration(
	provider: IntegrationProvider,
): Promise<Result<unknown, Error>> {
	const res = await client.integrations[':provider'].$delete({ param: { provider } })
	return to_result<unknown>(res, t('api.deleteFailed', { noun: noun() }))
}

export async function test_integration(
	provider: IntegrationProvider,
	input: IntegrationTest,
): Promise<Result<unknown, Error>> {
	const res = await client.integrations[':provider'].test.$post({
		param: { provider },
		json: input,
	})
	return to_result<unknown>(res, t('integration.testFailed'))
}

export async function start_sync(
	provider: IntegrationProvider,
	tenant?: number,
): Promise<Result<SyncRunJson, Error>> {
	const res = await client.integrations[':provider'].sync.$post({
		param: { provider },
		query: to_query({ tenant }),
	})
	return to_result<SyncRunJson>(res, t('integration.syncFailed'))
}

export async function fetch_sync_run(
	provider: IntegrationProvider,
	id: number,
): Promise<Result<SyncRunJson, Error>> {
	const res = await client.integrations[':provider'].sync[':id'].$get({
		param: { provider, id: String(id) },
	})
	return to_result<SyncRunJson>(res, t('integration.syncFailed'))
}

/** Polls a sync run until it leaves `running` (1.5 s steps). */
export async function wait_for_sync(
	provider: IntegrationProvider,
	run: SyncRunJson,
): Promise<Result<SyncRunJson, Error>> {
	let current = run
	while (current.state === 'running') {
		await new Promise((resolve) => setTimeout(resolve, 1500))
		const res = await fetch_sync_run(provider, current.id)
		if (Result.isError(res)) {
			return res
		}
		current = res.value
	}
	return Result.ok(current)
}

export async function fetch_external_tenants(
	provider: IntegrationProvider,
	search: string,
): Promise<Result<ExternalTenantListItem[], Error>> {
	const res = await client.integrations[':provider'].tenants.$get({
		param: { provider },
		query: { search },
	})
	return to_result<ExternalTenantListItem[]>(
		res,
		tp('api.loadFailed', 2, { noun: tp('noun.externalTenant', 2) }),
	)
}

export async function fetch_integration_report(
	provider: IntegrationProvider,
	filters: { tenant?: number; tenant_group?: number },
): Promise<Result<IntegrationReport, Error>> {
	const res = await client.integrations[':provider'].report.$get({
		param: { provider },
		query: to_query({ tenant: filters.tenant, tenant_group: filters.tenant_group }),
	})
	return to_result<IntegrationReport>(res, t('integration.reportFailed'))
}

export async function fetch_tenant_integration(
	provider: IntegrationProvider,
	tenantId: number,
): Promise<Result<TenantIntegrationStatus, Error>> {
	const res = await client.integrations[':provider']['tenant-status'][':id'].$get({
		param: { provider, id: String(tenantId) },
	})
	return to_result<TenantIntegrationStatus>(res, t('integration.statusFailed'))
}

export async function fetch_device_integration(
	provider: IntegrationProvider,
	deviceId: number,
): Promise<Result<DeviceIntegrationStatus, Error>> {
	const res = await client.integrations[':provider']['device-status'][':id'].$get({
		param: { provider, id: String(deviceId) },
	})
	return to_result<DeviceIntegrationStatus>(res, t('integration.statusFailed'))
}

export async function link_external(
	provider: IntegrationProvider,
	entity_type: LinkEntityType,
	entity_id: number,
	external_id: string,
): Promise<Result<ExternalLinkJson, Error>> {
	const res = await client.integrations[':provider'].links.$put({
		param: { provider },
		json: { entity_type, entity_id, external_id },
	})
	return to_result<ExternalLinkJson>(res, t('integration.linkFailed'))
}

export async function ignore_external(
	provider: IntegrationProvider,
	entity_type: LinkEntityType,
	external_id: string,
): Promise<Result<ExternalLinkJson, Error>> {
	const res = await client.integrations[':provider'].links.ignore.$put({
		param: { provider },
		json: { entity_type, external_id },
	})
	return to_result<ExternalLinkJson>(res, t('integration.linkFailed'))
}

export async function unlink_external(
	provider: IntegrationProvider,
	linkId: number,
): Promise<Result<unknown, Error>> {
	const res = await client.integrations[':provider'].links[':id'].$delete({
		param: { provider, id: String(linkId) },
	})
	return to_result<unknown>(res, t('integration.unlinkFailed'))
}
