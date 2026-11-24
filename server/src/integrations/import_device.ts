/**
 * Creates a conex device from an external device of an external tenant
 * linked to the device's tenant and links the two, so the report no longer
 * lists it as missing. The device type and role are picked by the user (the
 * board suggests a type by model); name, serial, asset tag and status come
 * from the external device. For site-level providers (UniFi) the device is
 * placed on the site linked to its console.
 */
import { Result } from 'better-result'
import { eq } from 'drizzle-orm'
import type { ExternalDeviceImport, IntegrationProvider as ProviderId } from 'shared/src/schemas'
import { getDb } from '../db/connection'
import { createDevice, type DeviceRow } from '../db/devices'
import { DuplicateError, NotFoundError, ValidationError } from '../db/errors'
import { device_types, manufacturers } from '../schema'
import { listLinks, scopeLinks, setLink } from './links'
import { normalizeName } from './match'
import { readDevice } from './snapshot'
import type { ExternalDevice } from './types'

/**
 * Resolves an external device's manufacturer + model to the conex device
 * type with that model, narrowed by manufacturer when several share it;
 * null unless exactly one matches.
 */
export async function deviceTypeMatcher(): Promise<(device: ExternalDevice) => number | null> {
	const rows = await getDb()
		.select({
			id: device_types.id,
			model: device_types.model,
			manufacturer: manufacturers.name,
		})
		.from(device_types)
		.innerJoin(manufacturers, eq(device_types.manufacturer_id, manufacturers.id))
	const byModel = new Map<string, { id: number; manufacturer: string | null }[]>()
	for (const row of rows) {
		const key = normalizeName(row.model)
		if (key !== null) {
			byModel.set(key, [
				...(byModel.get(key) ?? []),
				{ id: row.id, manufacturer: normalizeName(row.manufacturer) },
			])
		}
	}
	return (device: ExternalDevice): number | null => {
		const model = normalizeName(device.model)
		const candidates = model === null ? [] : (byModel.get(model) ?? [])
		if (candidates.length === 1) {
			return candidates[0]?.id ?? null
		}
		const manufacturer = normalizeName(device.manufacturer)
		const narrowed = candidates.filter((c) => c.manufacturer === manufacturer)
		return narrowed.length === 1 ? (narrowed[0]?.id ?? null) : null
	}
}

/** Trims an external value to a conex column limit; empty becomes undefined. */
function clip(raw: string | null, max: number): string | undefined {
	const text = raw?.trim().slice(0, max)
	return text ? text : undefined
}

export async function importExternalDevice(
	provider: ProviderId,
	input: ExternalDeviceImport,
	userId: number,
): Promise<Result<DeviceRow, Error>> {
	const scopes = await scopeLinks(provider, [input.tenant_id])
	if (scopes.length === 0) {
		return Result.err(new ValidationError('The tenant is not linked yet'))
	}
	const external = await readDevice(provider, input.external_id)
	const scope = scopes.find((s) => s.link.external_id === external?.external_tenant_id)
	if (!external || !scope) {
		return Result.err(new NotFoundError(`External device ${input.external_id} not found`))
	}
	const taken = (await listLinks(provider, 'device')).some(
		(l) => l.external_id === external.external_id,
	)
	if (taken) {
		return Result.err(new DuplicateError(`${external.name} is already linked or ignored`))
	}
	const device = await createDevice({
		device_type_id: input.device_type_id,
		device_role_id: input.device_role_id,
		name: input.name,
		status: external.active ? 'active' : 'inactive',
		serial: clip(external.serial, 100),
		asset_tag: clip(external.asset_tag, 100),
		tenant_id: input.tenant_id,
		...(scope.site_id !== null ? { site_id: scope.site_id } : {}),
		employee_ids: [],
	})
	if (Result.isError(device)) {
		return device
	}
	const link = await setLink(
		provider,
		{
			entity_type: 'device',
			entity_id: device.value.id,
			external_id: external.external_id,
			external_tenant_id: external.external_tenant_id,
		},
		'manual',
		userId,
	)
	return link.map(() => device.value)
}
