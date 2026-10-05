/**
 * Creates a conex device in the external system: the device's tenant must be
 * linked to an external company and the device itself must not be linked
 * yet. The new external device is added to the snapshot and linked right
 * away, so the report no longer lists it as missing.
 */
import { Result } from 'better-result'
import { eq } from 'drizzle-orm'
import type { ExternalLinkJson, IntegrationProvider as ProviderId } from 'shared/src/schemas'
import { getDb } from '../db/connection'
import { DuplicateError, ExternalServiceError, NotFoundError, ValidationError } from '../db/errors'
import { device_roles, devices } from '../schema'
import { nowSeconds } from '../util/time'
import { linkJson, linkOf, setLink } from './links'
import { localDevices } from './report'
import { upsertDevice } from './snapshot'
import { getIntegrationRow, providerFor } from './store'

export async function createExternalDevice(
	provider: ProviderId,
	deviceId: number,
	userId: number,
): Promise<Result<ExternalLinkJson, Error>> {
	const [device] = await localDevices(eq(devices.id, deviceId))
	if (!device) {
		return Result.err(new NotFoundError('Device not found'))
	}
	if (await linkOf(provider, 'device', device.id)) {
		return Result.err(new DuplicateError('Device is already linked'))
	}
	const company =
		device.tenant_id !== null ? await linkOf(provider, 'tenant', device.tenant_id) : null
	if (!company) {
		return Result.err(new ValidationError("The device's tenant is not linked yet"))
	}
	const [role] = await getDb()
		.select({ key: device_roles.key })
		.from(devices)
		.innerJoin(device_roles, eq(devices.device_role_id, device_roles.id))
		.where(eq(devices.id, device.id))
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
	if (!instance.createDevice) {
		return Result.err(new ValidationError('Integration does not support creating devices'))
	}
	const created = await instance.createDevice({
		externalTenantId: company.external_id,
		name: device.name,
		serial: device.serial,
		asset_tag: device.asset_tag,
		manufacturer: device.manufacturer,
		model: device.model,
		server: role?.key === 'server',
		active: device.status === 'active',
	})
	if (Result.isError(created)) {
		return Result.err(new ExternalServiceError(created.error.message))
	}
	await upsertDevice(provider, created.value, nowSeconds())
	const link = await setLink(
		provider,
		{
			entity_type: 'device',
			entity_id: device.id,
			external_id: created.value.external_id,
			external_tenant_id: company.external_id,
		},
		'manual',
		userId,
	)
	return link.map(linkJson)
}
