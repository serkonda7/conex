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
import { DuplicateError, NotFoundError, ValidationError } from '../db/errors'
import { device_roles, devices } from '../schema'
import { nowSeconds } from '../util/time'
import { deviceScopeLinks, linkJson, linkOf, setLink, tenantLevel } from './links'
import { localDevices } from './report'
import { upsertDevice } from './snapshot'
import { enabledProviderMethod } from './store'

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
	const company = (await deviceScopeLinks(provider, device.id))[0]
	if (!company) {
		return Result.err(
			new ValidationError(`The device's ${tenantLevel(provider)} is not linked yet`),
		)
	}
	const [role] = await getDb()
		.select({ key: device_roles.key })
		.from(devices)
		.innerJoin(device_roles, eq(devices.device_role_id, device_roles.id))
		.where(eq(devices.id, device.id))
	const createDevice = await enabledProviderMethod(provider, 'createDevice', 'creating devices')
	if (Result.isError(createDevice)) {
		return createDevice
	}
	const created = await createDevice.value({
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
		return created
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
