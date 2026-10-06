import { Result } from 'better-result'
import { asc, eq } from 'drizzle-orm'
import type { DeviceRoleCreate, DeviceRoleUpdate } from 'shared/src/schemas'
import { device_roles, devices } from '../schema'
import { logCreate, logDelete, logUpdate } from './changelog'
import { getDb } from './connection'
import { ConflictError, DuplicateError, ValidationError } from './errors'
import type { ListParams, Page } from './list'
import {
	checkExists,
	countBy,
	exists,
	findById,
	insertedId,
	isPatchEmpty,
	isTaken,
	orderOf,
	pageRows,
	pickDefined,
	searchCondition,
	tryWrite,
} from './list'

export type DeviceRoleRow = typeof device_roles.$inferSelect
export type DeviceRoleListRow = DeviceRoleRow & { device_count: number }

// ---------------------------------------------------------------------------
// Device roles (NetBox-style functional roles: `Server`, `Switch`, …).
// Shared catalog data (no tenant column): readable by every authenticated
// user, writable only by global editors/admins. Every device carries exactly
// one role, so delete is blocked while devices reference the role.
// Built-in roles (`key` set, see `DEVICE_ROLE_KEYS`) keep their name and
// cannot be deleted; only their description and icon are editable.
// ---------------------------------------------------------------------------

const NAME_IN_USE = 'Device role name is already in use'

export interface DeviceRoleListParams extends ListParams {
	sort: 'name' | 'description'
	order: 'asc' | 'desc'
}

export async function listDeviceRoles(
	params: DeviceRoleListParams,
): Promise<Page<DeviceRoleListRow>> {
	const orderColumn = params.sort === 'description' ? device_roles.description : device_roles.name
	const page = await pageRows(
		device_roles,
		searchCondition(params.search, [device_roles.name, device_roles.description]),
		[orderOf(orderColumn, params.order), asc(device_roles.id)],
		params,
	)
	const counts = await countBy(
		devices.device_role_id,
		page.items.map((r) => r.id),
	)
	return {
		...page,
		items: page.items.map((r) => ({ ...r, device_count: counts.get(r.id) ?? 0 })),
	}
}

export function getDeviceRole(id: number): Promise<Result<DeviceRoleRow, Error>> {
	return findById(device_roles, id, 'Device role not found')
}

export function checkDeviceRoleExists(roleId: number): Promise<Result<undefined, Error>> {
	return checkExists(device_roles, roleId, 'Device role not found')
}

export async function createDeviceRole(
	input: DeviceRoleCreate,
): Promise<Result<DeviceRoleRow, Error>> {
	if (await isTaken(device_roles, eq(device_roles.name, input.name))) {
		return Result.err(new DuplicateError(NAME_IN_USE))
	}
	const row: Omit<DeviceRoleRow, 'id'> = {
		name: input.name,
		description: input.description ?? null,
		icon: input.icon ?? null,
		key: null,
	}
	const id = await tryWrite(
		async () =>
			insertedId(
				await getDb().insert(device_roles).values(row).returning({ id: device_roles.id }),
			),
		NAME_IN_USE,
	)
	if (Result.isError(id)) {
		return id
	}
	return await logCreate('device_role', await getDeviceRole(id.value))
}

export async function updateDeviceRole(
	id: number,
	input: DeviceRoleUpdate,
): Promise<Result<DeviceRoleRow, Error>> {
	const current = await getDeviceRole(id)
	if (Result.isError(current)) {
		return current
	}
	if (
		input.name !== undefined &&
		(await isTaken(device_roles, eq(device_roles.name, input.name), id))
	) {
		return Result.err(new DuplicateError(NAME_IN_USE))
	}
	if (
		current.value.key !== null &&
		input.name !== undefined &&
		input.name !== current.value.name
	) {
		return Result.err(new ValidationError('Built-in device roles cannot be renamed'))
	}
	const patch = pickDefined(input, ['name', 'description', 'icon'])
	if (!isPatchEmpty(patch)) {
		const written = await tryWrite(
			() => getDb().update(device_roles).set(patch).where(eq(device_roles.id, id)),
			NAME_IN_USE,
		)
		if (Result.isError(written)) {
			return written
		}
	}
	return await logUpdate('device_role', current.value, await getDeviceRole(id))
}

export async function deleteDeviceRole(id: number): Promise<Result<DeviceRoleRow, Error>> {
	const current = await getDeviceRole(id)
	if (Result.isError(current)) {
		return current
	}
	if (current.value.key !== null) {
		return Result.err(new ConflictError('Built-in device roles cannot be deleted'))
	}
	if (await exists(devices, eq(devices.device_role_id, id))) {
		return Result.err(
			new ConflictError('Device role still has devices; move or delete them first'),
		)
	}
	const deleted = await tryWrite(() =>
		getDb().delete(device_roles).where(eq(device_roles.id, id)),
	)
	if (Result.isError(deleted)) {
		return deleted
	}
	return await logDelete('device_role', current.value)
}
