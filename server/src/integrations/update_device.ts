/**
 * Overwrites one field of a linked external device with the conex value
 * (resolves a `device_mismatch` finding from the conex side). The updated
 * external device replaces its snapshot row, so the finding disappears
 * without a sync.
 */
import { Result } from 'better-result'
import { eq } from 'drizzle-orm'
import type {
	ExternalDeviceJson,
	ExternalPushField,
	IntegrationProvider as ProviderId,
} from 'shared/src/schemas'
import { ExternalServiceError, NotFoundError, ValidationError } from '../db/errors'
import { devices } from '../schema'
import { nowSeconds } from '../util/time'
import { linkOf } from './links'
import { localDevices } from './report'
import { upsertDevice } from './snapshot'
import { getIntegrationRow, providerFor } from './store'

export async function updateExternalDevice(
	provider: ProviderId,
	deviceId: number,
	field: ExternalPushField,
): Promise<Result<ExternalDeviceJson, Error>> {
	const [device] = await localDevices(eq(devices.id, deviceId))
	if (!device) {
		return Result.err(new NotFoundError('Device not found'))
	}
	const link = await linkOf(provider, 'device', device.id)
	if (!link) {
		return Result.err(new ValidationError('Device is not linked'))
	}
	const value = device[field]
	if (value === null) {
		return Result.err(new ValidationError(`Device has no ${field}`))
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
	if (!instance.updateDevice) {
		return Result.err(new ValidationError('Integration does not support updating devices'))
	}
	const updated = await instance.updateDevice(link.external_id, { [field]: value })
	if (Result.isError(updated)) {
		return Result.err(new ExternalServiceError(updated.error.message))
	}
	await upsertDevice(provider, updated.value, nowSeconds())
	return Result.ok(updated.value)
}
