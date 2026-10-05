/**
 * Ticket creation in the external system: the tenant must be linked to an
 * external company; an optional device must belong to that tenant and is
 * attached to the ticket when it is linked too.
 */
import { Result } from 'better-result'
import { eq } from 'drizzle-orm'
import type {
	IntegrationProvider as ProviderId,
	TicketCreate,
	TicketCreated,
} from 'shared/src/schemas'
import { ExternalServiceError, NotFoundError, ValidationError } from '../db/errors'
import { findOne } from '../db/list'
import { devices, tenants } from '../schema'
import { linkOf } from './links'
import { getIntegrationRow, providerFor } from './store'

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
	const row = await getIntegrationRow(provider)
	if (Result.isError(row)) {
		return row
	}
	if (!row.value.enabled) {
		return Result.err(new ValidationError('Integration is disabled'))
	}
	const built = providerFor(row.value)
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
