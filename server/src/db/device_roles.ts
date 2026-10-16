import { Result } from 'better-result'
import { and, eq } from 'drizzle-orm'
import type { DeviceRoleCreate, DeviceRoleUpdate } from 'shared/src/schemas'
import { device_roles, devices, virtual_machines } from '../schema'
import {
	buildChildrenMap,
	buildParentMap,
	createsCycle,
	sortHierarchically,
	subtreeIds,
} from '../services/hierarchy'
import { logCreate, logDelete, logUpdate } from './changelog'
import { getDb } from './connection'
import { ConflictError, DuplicateError, NotFoundError, ValidationError } from './errors'
import type { ListParams, Page } from './list'
import {
	checkExists,
	countBy,
	exists,
	findById,
	insertedId,
	isPatchEmpty,
	isTaken,
	offsetOf,
	pageOf,
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
// cannot be deleted; only their description, icon, parent and VM hosting
// flag are editable.
// Roles nest (NetBox 4.3-style): `parent_id` forms a tree without a depth
// cap, and filtering devices by a role includes its descendant roles.
// ---------------------------------------------------------------------------

const NAME_IN_USE = 'Device role name is already in use'

export interface DeviceRoleListParams extends ListParams {
	parent?: number
	sort: 'name' | 'description'
	order: 'asc' | 'desc'
}

export async function listDeviceRoles(
	params: DeviceRoleListParams,
): Promise<Page<DeviceRoleListRow>> {
	const where = and(
		searchCondition(params.search, [device_roles.name, device_roles.description]),
		params.parent ? eq(device_roles.parent_id, params.parent) : undefined,
	)
	const matching = await getDb().select().from(device_roles).where(where)
	const ordered = sortHierarchically(matching, params.sort, params.order)
	const offset = offsetOf(params)
	const items = ordered.slice(offset, offset + params.limit)
	const ids = items.map((r) => r.id)
	const counts = await countBy(devices.device_role_id, ids)
	const vmCounts = await countBy(virtual_machines.device_role_id, ids)
	return pageOf(
		items.map((r) => ({
			...r,
			device_count: (counts.get(r.id) ?? 0) + (vmCounts.get(r.id) ?? 0),
		})),
		matching.length,
		params,
	)
}

export function getDeviceRole(id: number): Promise<Result<DeviceRoleRow, Error>> {
	return findById(device_roles, id, 'Device role not found')
}

export function checkDeviceRoleExists(roleId: number): Promise<Result<undefined, Error>> {
	return checkExists(device_roles, roleId, 'Device role not found')
}

/** Parent links of every device role, for cycle checks and subtree walks. */
function roleTree(): Promise<{ id: number; parent_id: number | null }[]> {
	return getDb()
		.select({ id: device_roles.id, parent_id: device_roles.parent_id })
		.from(device_roles)
}

/**
 * Ids of a role and all its descendant roles, so a role filter matches
 * devices of child roles too.
 */
export async function deviceRoleSubtree(roleId: number): Promise<number[]> {
	return subtreeIds(roleId, buildChildrenMap(await roleTree()))
}

/**
 * Validates placing a role under `parentId`: the parent must exist and, when
 * moving an existing role (`nodeId`), must not be the role itself or one of
 * its descendants.
 */
async function checkDeviceRoleParent(
	parentId: number,
	nodeId?: number,
): Promise<Result<undefined, Error>> {
	const parents = buildParentMap(await roleTree())
	if (!parents.has(parentId)) {
		return Result.err(new NotFoundError('Parent device role not found'))
	}
	if (nodeId !== undefined && (parentId === nodeId || createsCycle(nodeId, parentId, parents))) {
		return Result.err(
			new ConflictError('Cannot set a device role as its own parent or descendant'),
		)
	}
	return Result.ok(undefined)
}

export async function createDeviceRole(
	input: DeviceRoleCreate,
): Promise<Result<DeviceRoleRow, Error>> {
	if (await isTaken(device_roles, eq(device_roles.name, input.name))) {
		return Result.err(new DuplicateError(NAME_IN_USE))
	}
	const parentId = input.parent_id ?? null
	if (parentId !== null) {
		const parent = await checkDeviceRoleParent(parentId)
		if (Result.isError(parent)) {
			return parent
		}
	}
	const row: Omit<DeviceRoleRow, 'id'> = {
		parent_id: parentId,
		name: input.name,
		description: input.description ?? null,
		icon: input.icon ?? null,
		can_host_vms: input.can_host_vms ? 1 : 0,
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
	if (input.parent_id != null) {
		const parent = await checkDeviceRoleParent(input.parent_id, id)
		if (Result.isError(parent)) {
			return parent
		}
	}
	const patch = {
		...pickDefined(input, ['name', 'parent_id', 'description', 'icon']),
		...(input.can_host_vms !== undefined ? { can_host_vms: input.can_host_vms ? 1 : 0 } : {}),
	}
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
	if (await exists(device_roles, eq(device_roles.parent_id, id))) {
		return Result.err(
			new ConflictError('Device role still has child roles; move or delete them first'),
		)
	}
	if (
		(await exists(devices, eq(devices.device_role_id, id))) ||
		(await exists(virtual_machines, eq(virtual_machines.device_role_id, id)))
	) {
		return Result.err(
			new ConflictError(
				'Device role still has devices or virtual machines; move or delete them first',
			),
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
