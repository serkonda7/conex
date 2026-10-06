/**
 * Integrations API wrappers (TANSS; more providers later): configuration,
 * sync runs, links and the consistency report. Errors surface as
 * `Result.err` with the server's `{ error }` message.
 */
import { Result } from 'better-result'
import type {
	DeviceIntegrationStatus,
	ExternalDeviceJson,
	ExternalLinkJson,
	ExternalPushField,
	ExternalTenantJson,
	ExternalTenantListItem,
	IntegrationCreate,
	IntegrationJson,
	IntegrationProvider,
	IntegrationReport,
	IntegrationTest,
	IntegrationUpdate,
	LinkBoard,
	LinkBoardExternal,
	LinkBoardLocal,
	LinkEntityType,
	SyncRunJson,
	TenantIntegrationStatus,
	TicketCreate,
	TicketCreated,
	TicketListJson,
} from 'shared/src/types'
import { t } from '../i18n'
import { client, failed, to_query, to_result } from './client'

export type {
	DeviceIntegrationStatus,
	ExternalLinkJson,
	ExternalTenantJson,
	ExternalTenantListItem,
	IntegrationJson,
	IntegrationProvider,
	IntegrationReport,
	LinkBoard,
	LinkBoardExternal,
	LinkBoardLocal,
	SyncRunJson,
	TenantIntegrationStatus,
	TicketListJson,
}

export async function fetch_integrations(): Promise<Result<IntegrationJson[], Error>> {
	const res = await client.integrations.$get()
	return to_result<IntegrationJson[]>(res, failed.list('noun.integration'))
}

/** One integration by id, from the list endpoint (there is no single-row route). */
export async function fetch_integration(id: number): Promise<Result<IntegrationJson, Error>> {
	const res = await fetch_integrations()
	if (Result.isError(res)) {
		return res
	}
	const row = res.value.find((i) => i.id === id)
	return row ? Result.ok(row) : Result.err(new Error(t('integration.notFound')))
}

export async function create_integration(
	input: IntegrationCreate,
): Promise<Result<IntegrationJson, Error>> {
	const res = await client.integrations.$post({ json: input })
	return to_result<IntegrationJson>(res, failed.create('noun.integration'))
}

export async function update_integration(
	provider: IntegrationProvider,
	patch: IntegrationUpdate,
): Promise<Result<IntegrationJson, Error>> {
	const res = await client.integrations[':provider'].$patch({ param: { provider }, json: patch })
	return to_result<IntegrationJson>(res, failed.update('noun.integration'))
}

export async function delete_integration(
	provider: IntegrationProvider,
): Promise<Result<unknown, Error>> {
	const res = await client.integrations[':provider'].$delete({ param: { provider } })
	return to_result<unknown>(res, failed.delete('noun.integration'))
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
	clean = false,
): Promise<Result<SyncRunJson, Error>> {
	const res = await client.integrations[':provider'].sync.$post({
		param: { provider },
		query: { ...to_query({ tenant }), clean: clean ? 'true' : undefined },
	})
	return to_result<SyncRunJson>(res, t('integration.syncFailed'))
}

export async function create_ticket(
	provider: IntegrationProvider,
	input: TicketCreate,
): Promise<Result<TicketCreated, Error>> {
	const res = await client.integrations[':provider'].tickets.$post({
		param: { provider },
		json: input,
	})
	return to_result<TicketCreated>(res, t('ticket.createFailed'))
}

/** Open tickets of `tenant` (scoped users: always their own tenant). */
export async function fetch_tickets(
	provider: IntegrationProvider,
	tenant?: number,
): Promise<Result<TicketListJson, Error>> {
	const res = await client.integrations[':provider'].tickets.$get({
		param: { provider },
		query: to_query({ tenant }),
	})
	return to_result<TicketListJson>(res, t('ticket.listFailed'))
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

/** Starts a sync run and waits for it; a run that ends in `error` fails. */
export async function run_sync(
	provider: IntegrationProvider,
	tenant?: number,
	clean = false,
): Promise<Result<SyncRunJson, Error>> {
	const started = await start_sync(provider, tenant, clean)
	if (Result.isError(started)) {
		return started
	}
	const done = await wait_for_sync(provider, started.value)
	if (Result.isOk(done) && done.value.state === 'error') {
		return Result.err(new Error(done.value.error ?? t('integration.syncFailed')))
	}
	return done
}

export async function fetch_external_tenants(
	provider: IntegrationProvider,
	search: string,
): Promise<Result<ExternalTenantListItem[], Error>> {
	const res = await client.integrations[':provider'].tenants.$get({
		param: { provider },
		query: { search },
	})
	return to_result<ExternalTenantListItem[]>(res, failed.list('noun.externalTenant'))
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

/** Link board of tenants, or of one tenant's devices. */
export async function fetch_link_board(
	provider: IntegrationProvider,
	entity_type: LinkEntityType,
	tenant?: number,
): Promise<Result<LinkBoard, Error>> {
	const res = await client.integrations[':provider'].board.$get({
		param: { provider },
		query: { entity_type, ...to_query({ tenant }) },
	})
	return to_result<LinkBoard>(res, t('integration.boardFailed'))
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

/** Marks a conex device as intentionally absent from the external system. */
export async function ignore_local_device(
	provider: IntegrationProvider,
	entity_id: number,
): Promise<Result<ExternalLinkJson, Error>> {
	const res = await client.integrations[':provider'].links['ignore-local'].$put({
		param: { provider },
		json: { entity_type: 'device', entity_id },
	})
	return to_result<ExternalLinkJson>(res, t('integration.linkFailed'))
}

/** Creates a conex device in the external system and links the two. */
export async function create_external_device(
	provider: IntegrationProvider,
	device_id: number,
): Promise<Result<ExternalLinkJson, Error>> {
	const res = await client.integrations[':provider'].devices.$post({
		param: { provider },
		json: { device_id },
	})
	return to_result<ExternalLinkJson>(res, t('integration.createExternalFailed'))
}

/** Overwrites one field of the linked external device with the conex value. */
export async function update_external_device(
	provider: IntegrationProvider,
	device_id: number,
	field: ExternalPushField,
): Promise<Result<ExternalDeviceJson, Error>> {
	const res = await client.integrations[':provider'].devices.$put({
		param: { provider },
		json: { device_id, field },
	})
	return to_result<ExternalDeviceJson>(res, t('integration.updateExternalFailed'))
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
