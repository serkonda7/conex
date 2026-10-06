/**
 * Tickets in the external system. Creation: the tenant must be linked to an
 * external company; an optional device must belong to that tenant and is
 * attached to the ticket when it is linked too. Listing: the open tickets
 * of a linked tenant, cached per company for `TICKET_CACHE_SECONDS`.
 */
import { Result } from 'better-result'
import { eq } from 'drizzle-orm'
import type {
	IntegrationProvider as ProviderId,
	TicketCreate,
	TicketCreated,
	TicketListJson,
} from 'shared/src/schemas'
import { ExternalServiceError, NotFoundError, ValidationError } from '../db/errors'
import { findOne } from '../db/list'
import { devices, tenants } from '../schema'
import { nowSeconds } from '../util/time'
import { linkOf } from './links'
import { getIntegrationRow, providerFor } from './store'
import type { ExternalTicket, IntegrationProvider } from './types'

/** Ticket lists are fetched from the external system at most this often. */
const TICKET_CACHE_SECONDS = 30 * 60

/** `provider:externalCompanyId` → last fetched open tickets. */
const ticketCache = new Map<string, { fetched_at: number; tickets: ExternalTicket[] }>()

/** Provider instance of an enabled integration. */
async function enabledProvider(provider: ProviderId): Promise<Result<IntegrationProvider, Error>> {
	const row = await getIntegrationRow(provider)
	if (Result.isError(row)) {
		return row
	}
	if (!row.value.enabled) {
		return Result.err(new ValidationError('Integration is disabled'))
	}
	return providerFor(row.value)
}

export async function createTicket(
	provider: ProviderId,
	input: TicketCreate,
): Promise<Result<TicketCreated, Error>> {
	const tenant = await findOne(tenants, eq(tenants.id, input.tenant_id))
	if (!tenant) {
		return Result.err(new NotFoundError('Tenant not found'))
	}
	let externalDeviceId: string | undefined
	if (input.device_id !== undefined) {
		const device = await findOne(devices, eq(devices.id, input.device_id))
		if (!device) {
			return Result.err(new NotFoundError('Device not found'))
		}
		if (device.tenant_id !== tenant.id) {
			return Result.err(new ValidationError('Device does not belong to the tenant'))
		}
		externalDeviceId = (await linkOf(provider, 'device', device.id))?.external_id
	}
	const company = await linkOf(provider, 'tenant', tenant.id)
	if (!company) {
		return Result.err(new ValidationError('Tenant is not linked to an external company'))
	}
	const built = await enabledProvider(provider)
	if (Result.isError(built)) {
		return built
	}
	const instance = built.value
	if (!instance.createTicket) {
		return Result.err(new ValidationError('Integration does not support tickets'))
	}
	const created = await instance.createTicket({
		externalTenantId: company.external_id,
		...(externalDeviceId !== undefined ? { externalDeviceId } : {}),
		title: input.title,
		content: input.content,
	})
	if (Result.isError(created)) {
		return Result.err(new ExternalServiceError(created.error.message))
	}
	return Result.ok({ id: created.value })
}

/** Open tickets of a tenant, newest change first. */
export async function listTickets(
	provider: ProviderId,
	tenantId: number,
): Promise<Result<TicketListJson, Error>> {
	const tenant = await findOne(tenants, eq(tenants.id, tenantId))
	if (!tenant) {
		return Result.err(new NotFoundError('Tenant not found'))
	}
	const company = await linkOf(provider, 'tenant', tenant.id)
	if (!company) {
		return Result.ok({ linked: false, fetched_at: null, tickets: [] })
	}
	const key = `${provider}:${company.external_id}`
	const cached = ticketCache.get(key)
	if (cached && nowSeconds() - cached.fetched_at < TICKET_CACHE_SECONDS) {
		return Result.ok({ linked: true, ...cached })
	}
	const built = await enabledProvider(provider)
	if (Result.isError(built)) {
		return built
	}
	const instance = built.value
	if (!instance.listTickets) {
		return Result.err(new ValidationError('Integration does not support tickets'))
	}
	const listed = await instance.listTickets(company.external_id)
	if (Result.isError(listed)) {
		return Result.err(new ExternalServiceError(listed.error.message))
	}
	const entry = {
		fetched_at: nowSeconds(),
		tickets: listed.value.toSorted(
			(a, b) => (b.modified_at ?? b.created_at ?? 0) - (a.modified_at ?? a.created_at ?? 0),
		),
	}
	ticketCache.set(key, entry)
	return Result.ok({ linked: true, ...entry })
}
