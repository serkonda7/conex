import { Result } from 'better-result'
import { asc, count, desc, eq, sql } from 'drizzle-orm'
import type { DeviceRoleCreate, DeviceRoleUpdate } from 'shared/src/schemas'
import { device_roles, devices } from '../schema'
import { logCreate, logDelete, logUpdate } from './changelog'
import { getDb } from './connection'
import { ConflictError, DuplicateError, isUniqueViolation, NotFoundError } from './errors'
import type { ListParams, Page } from './list'
import { errOf, isPatchEmpty, offsetOf, pageOf, searchPattern } from './list'

export type DeviceRoleRow = typeof device_roles.$inferSelect

// ---------------------------------------------------------------------------
// Device roles (NetBox-style functional roles: `Server`, `Switch`, …).
// Shared catalog data (no tenant column): readable by every authenticated
// user, writable only by global editors/admins. Every device carries exactly
// one role, so delete is blocked while devices reference the role.
// ---------------------------------------------------------------------------

export interface DeviceRoleListParams extends ListParams {
	sort: 'name' | 'description'
	order: 'asc' | 'desc'
}

export async function listDeviceRoles(params: DeviceRoleListParams): Promise<Page<DeviceRoleRow>> {
	const db = getDb()
	const pattern = searchPattern(params.search)
	const where = params.search
		? sql`${device_roles.name} ILIKE ${pattern} ESCAPE '\\' OR ${device_roles.description} ILIKE ${pattern} ESCAPE '\\'`
		: undefined
	const orderColumn = params.sort === 'description' ? device_roles.description : device_roles.name
	const items = await db
		.select()
		.from(device_roles)
		.where(where)
		.orderBy(
			params.order === 'desc' ? desc(orderColumn) : asc(orderColumn),
			asc(device_roles.id),
		)
		.limit(params.limit)
		.offset(offsetOf(params))
	const totalRow = (await db.select({ n: count() }).from(device_roles).where(where).limit(1))[0]
	return pageOf(items, totalRow?.n ?? 0, params)
}

export async function getDeviceRole(id: number): Promise<Result<DeviceRoleRow, Error>> {
	const row = (
		await getDb().select().from(device_roles).where(eq(device_roles.id, id)).limit(1)
	)[0]
	if (!row) {
		return Result.err(new NotFoundError('Device role not found'))
	}
	return Result.ok(row)
}

export async function checkDeviceRoleExists(roleId: number): Promise<Result<undefined, Error>> {
	if (
		!(await getDb().select().from(device_roles).where(eq(device_roles.id, roleId)).limit(1))[0]
	) {
		return Result.err(new NotFoundError('Device role not found'))
	}
	return Result.ok(undefined)
}

export async function createDeviceRole(
	input: DeviceRoleCreate,
): Promise<Result<DeviceRoleRow, Error>> {
	const db = getDb()
	if (
		(await db.select().from(device_roles).where(eq(device_roles.name, input.name)).limit(1))[0]
	) {
		return Result.err(new DuplicateError('Device role name is already in use'))
	}
	const row: Omit<DeviceRoleRow, 'id'> = {
		name: input.name,
		description: input.description ?? null,
	}
	try {
		const inserted = (
			await db.insert(device_roles).values(row).returning({ id: device_roles.id })
		)[0]
		if (!inserted) {
			return Result.err(new Error('Device role insert did not return an id'))
		}
		return await logCreate('device_role', await getDeviceRole(inserted.id))
	} catch (err) {
		if (isUniqueViolation(err)) {
			return Result.err(new DuplicateError('Device role name is already in use'))
		}
		return Result.err(err instanceof Error ? err : new Error(String(err)))
	}
}

export async function updateDeviceRole(
	id: number,
	input: DeviceRoleUpdate,
): Promise<Result<DeviceRoleRow, Error>> {
	const current = await getDeviceRole(id)
	if (Result.isError(current)) {
		return current
	}
	if (input.name !== undefined && input.name !== current.value.name) {
		if (
			(
				await getDb()
					.select()
					.from(device_roles)
					.where(eq(device_roles.name, input.name))
					.limit(1)
			)[0]
		) {
			return Result.err(new DuplicateError('Device role name is already in use'))
		}
	}
	const patch: Partial<DeviceRoleRow> = {}
	if (input.name !== undefined) {
		patch.name = input.name
	}
	if (input.description !== undefined) {
		patch.description = input.description
	}
	if (!isPatchEmpty(patch)) {
		try {
			await getDb().update(device_roles).set(patch).where(eq(device_roles.id, id))
		} catch (err) {
			if (isUniqueViolation(err)) {
				return Result.err(new DuplicateError('Device role name is already in use'))
			}
			return Result.err(err instanceof Error ? err : new Error(String(err)))
		}
	}
	return await logUpdate('device_role', current.value, await getDeviceRole(id))
}

export async function deleteDeviceRole(id: number): Promise<Result<DeviceRoleRow, Error>> {
	const current = await getDeviceRole(id)
	if (Result.isError(current)) {
		return current
	}
	const device = (
		await getDb().select().from(devices).where(eq(devices.device_role_id, id)).limit(1)
	)[0]
	if (device) {
		return Result.err(
			new ConflictError('Device role still has devices; move or delete them first'),
		)
	}
	try {
		await getDb().delete(device_roles).where(eq(device_roles.id, id))
	} catch (e) {
		return Result.err(errOf(e))
	}
	return await logDelete('device_role', current.value)
}
