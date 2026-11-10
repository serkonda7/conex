import { Result } from 'better-result'
import { and, count, eq, getTableColumns, inArray, type SQL, sql } from 'drizzle-orm'
import type { PgColumn } from 'drizzle-orm/pg-core'
import type {
	DeviceRoleCreate,
	DeviceRoleListQuery,
	DeviceRoleUpdate,
	DeviceServiceJson,
} from 'shared/src/schemas'
import { device_roles, device_types, devices, managed_bundles, virtual_machines } from '../schema'
import {
	buildChildrenMap,
	buildParentMap,
	createsCycle,
	sortHierarchically,
	subtreeIds,
	withTreeLinks,
} from '../services/hierarchy'
import { logCreate, logDelete, logUpdate } from './changelog'
import { getDb } from './connection'
import { ConflictError, DuplicateError, NotFoundError, ValidationError } from './errors'
import type { ListParams, Page } from './list'
import {
	checkExists,
	countWhere,
	exists,
	findById,
	insertedId,
	isPatchEmpty,
	isTaken,
	offsetOf,
	pageOf,
	pickDefined,
	searchCondition,
	subquery,
	tryWrite,
} from './list'
import { tenantBundle } from './tenancy'

export type DeviceRoleRow = typeof device_roles.$inferSelect
/**
 * `device_type_count`: device types with the role as their default role.
 * `managed_bundle`: the role's effective bundle (own, else inherited from
 * the nearest ancestor), null when no role up the tree sets one.
 * `child_count` and `ancestor_ids` (root first) refer to the filtered tree,
 * so the client can collapse rows across pages.
 */
export type DeviceRoleListRow = DeviceRoleRow & {
	device_count: number
	device_type_count: number
	depth: number
	child_count: number
	ancestor_ids: number[]
	managed_bundle: { id: number; name: string; inherited: boolean } | null
}

// ---------------------------------------------------------------------------
// Device roles (NetBox-style functional roles: `Server`, `Switch`, …).
// Shared catalog data (no tenant column): readable by every authenticated
// user, writable only by global editors/admins. Every device carries exactly
// one role, so delete is blocked while devices reference the role.
// Built-in roles (`key` set, see `DEVICE_ROLE_KEYS`) keep their name and
// cannot be deleted; only their description, icon, parent, managed bundle
// and VM hosting flag are editable.
// Roles nest (NetBox 4.3-style): `parent_id` forms a tree without a depth
// cap, and filtering devices by a role includes its descendant roles.
// A role without a managed bundle inherits its nearest ancestor's.
// ---------------------------------------------------------------------------

const NAME_IN_USE = 'Device role name is already in use'

export interface DeviceRoleListParams extends ListParams {
	parent?: number
	can_host_vms?: boolean
	/** Effective managed bundle (own or inherited) is one of these. */
	bundle?: number[]
	sort: DeviceRoleListQuery['sort']
	order: 'asc' | 'desc'
}

export async function listDeviceRoles(
	params: DeviceRoleListParams,
): Promise<Page<DeviceRoleListRow>> {
	const where = and(
		searchCondition(params.search, [device_roles.name, device_roles.description]),
		params.parent ? eq(device_roles.parent_id, params.parent) : undefined,
		params.can_host_vms !== undefined
			? eq(device_roles.can_host_vms, params.can_host_vms ? 1 : 0)
			: undefined,
	)
	// Every role, flagged by the filter: bundles inherit through roles the
	// filter drops, so the tree is read once and filtered here.
	const all = await getDb()
		.select({
			...getTableColumns(device_roles),
			bundle_name: managed_bundles.name,
			matches: sql<boolean>`coalesce(${where ?? sql`true`}, false)`,
		})
		.from(device_roles)
		.leftJoin(managed_bundles, eq(managed_bundles.id, device_roles.managed_bundle_id))
	const tree = new Map(all.map((r) => [r.id, r]))
	const withBundle = all
		.filter((r) => r.matches)
		.map(({ bundle_name: _name, matches: _matches, ...r }) => {
			const ref = resolveBundle(tree, r.id)
			return { ...r, managed_bundle: bundleRefOf(tree, ref) }
		})
	const bundleIds = params.bundle ? new Set(params.bundle) : null
	const matching = bundleIds
		? withBundle.filter((r) => r.managed_bundle && bundleIds.has(r.managed_bundle.id))
		: withBundle
	const ordered = sortHierarchically(
		matching,
		params.sort === 'managed_bundle'
			? (r: (typeof matching)[number]): string => r.managed_bundle?.name ?? ''
			: params.sort,
		params.order,
	)
	const linked = withTreeLinks(ordered)
	const offset = offsetOf(params)
	const items = linked.slice(offset, offset + params.limit)
	const ids = items.map((r) => r.id)
	const counts = new Map(
		(ids.length === 0
			? []
			: await getDb()
					.select({
						id: device_roles.id,
						devices: countWhere(devices.device_role_id, device_roles.id),
						vms: countWhere(virtual_machines.device_role_id, device_roles.id),
						types: countWhere(device_types.default_device_role_id, device_roles.id),
					})
					.from(device_roles)
					.where(inArray(device_roles.id, ids))
		).map((r) => [r.id, r]),
	)
	return pageOf(
		items.map((r) => {
			const n = counts.get(r.id)
			return {
				...r,
				device_count: (n?.devices ?? 0) + (n?.vms ?? 0),
				device_type_count: n?.types ?? 0,
			}
		}),
		matching.length,
		params,
	)
}

export function getDeviceRole(id: number): Promise<Result<DeviceRoleRow, Error>> {
	return findById(device_roles, id, 'Device role not found')
}

/**
 * Device role detail: `child_count` counts direct child roles; device type and
 * device (incl. VM) counts cover the role's subtree, like the `role` filters of
 * the device type and device lists. `managed_bundle` as in the list rows.
 */
export type DeviceRoleDetail = DeviceRoleRow & {
	child_count: number
	device_type_count: number
	device_count: number
	managed_bundle: { id: number; name: string; inherited: boolean } | null
}

/** The device role with its counts and effective bundle, for the detail page. */
export async function getDeviceRoleDetail(id: number): Promise<Result<DeviceRoleDetail, Error>> {
	const tree = await roleNodes()
	if (!tree.has(id)) {
		return Result.err(new NotFoundError('Device role not found'))
	}
	const ids = subtreeIds(id, buildChildrenMap([...tree.values()]))
	const countIn = (column: PgColumn): SQL<number> =>
		sql<number>`(${subquery.select({ n: count() }).from(column.table).where(inArray(column, ids))})`.mapWith(
			Number,
		)
	const [row] = await getDb()
		.select({
			...getTableColumns(device_roles),
			child_count: countWhere(device_roles.parent_id, sql`${id}`),
			device_type_count: countIn(device_types.default_device_role_id),
			device_count: countIn(devices.device_role_id),
			vm_count: countIn(virtual_machines.device_role_id),
		})
		.from(device_roles)
		.where(eq(device_roles.id, id))
		.limit(1)
	if (!row) {
		return Result.err(new NotFoundError('Device role not found'))
	}
	const { vm_count, ...role } = row
	return Result.ok({
		...role,
		device_count: role.device_count + vm_count,
		managed_bundle: bundleRefOf(tree, resolveBundle(tree, id)),
	})
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

interface BundleNode {
	id: number
	parent_id: number | null
	managed_bundle_id: number | null
	/** Name of the role's own bundle. */
	bundle_name: string | null
}

/** Parent links and own bundle (with its name) of every device role, keyed by id. */
async function roleNodes(): Promise<Map<number, BundleNode>> {
	const rows = await getDb()
		.select({
			id: device_roles.id,
			parent_id: device_roles.parent_id,
			managed_bundle_id: device_roles.managed_bundle_id,
			bundle_name: managed_bundles.name,
		})
		.from(device_roles)
		.leftJoin(managed_bundles, eq(managed_bundles.id, device_roles.managed_bundle_id))
	return new Map(rows.map((r) => [r.id, r]))
}

/** `resolveBundle` result with the bundle's name, read off the role that sets it. */
function bundleRefOf(
	byId: Map<number, BundleNode>,
	ref: { id: number; inherited: boolean; owner: number } | null,
): { id: number; name: string; inherited: boolean } | null {
	const name = ref ? byId.get(ref.owner)?.bundle_name : null
	return ref && name != null ? { id: ref.id, name, inherited: ref.inherited } : null
}

/**
 * Nearest bundle up the tree from `roleId`; `inherited` when not the role's
 * own, `owner` is the role that sets it.
 */
function resolveBundle(
	byId: Map<number, BundleNode>,
	roleId: number,
): { id: number; inherited: boolean; owner: number } | null {
	const seen = new Set<number>()
	let role = byId.get(roleId)
	while (role && !seen.has(role.id)) {
		if (role.managed_bundle_id !== null) {
			return { id: role.managed_bundle_id, inherited: role.id !== roleId, owner: role.id }
		}
		seen.add(role.id)
		role = role.parent_id === null ? undefined : byId.get(role.parent_id)
	}
	return null
}

/**
 * Ids of the roles and all their descendant roles, so a role filter matches
 * devices of child roles too. Reads the role tree once for all of them.
 */
export async function deviceRoleSubtrees(roleIds: readonly number[]): Promise<number[]> {
	const children = buildChildrenMap(await roleTree())
	return [...new Set(roleIds.flatMap((id) => subtreeIds(id, children)))]
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
	const bundle = await checkExists(
		managed_bundles,
		input.managed_bundle_id,
		'Managed bundle not found',
	)
	if (Result.isError(bundle)) {
		return bundle
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
		managed_bundle_id: input.managed_bundle_id ?? null,
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
	const bundle = await checkExists(
		managed_bundles,
		input.managed_bundle_id,
		'Managed bundle not found',
	)
	if (Result.isError(bundle)) {
		return bundle
	}
	if (input.parent_id != null) {
		const parent = await checkDeviceRoleParent(input.parent_id, id)
		if (Result.isError(parent)) {
			return parent
		}
	}
	const patch = {
		...pickDefined(input, ['name', 'parent_id', 'description', 'icon', 'managed_bundle_id']),
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

/**
 * Managed service of a device or VM: the bundle its role falls under and the
 * SLA its tenant contracted for that bundle (none without a tenant, bundle or
 * contract).
 */
export async function serviceOf(
	roleId: number,
	tenantId: number | null,
): Promise<DeviceServiceJson> {
	const tree = await roleNodes()
	const bundle = bundleRefOf(tree, resolveBundle(tree, roleId))
	if (!bundle) {
		return { managed_bundle: null, service_level: null }
	}
	const contract = tenantId === null ? null : await tenantBundle(tenantId, bundle.id)
	return {
		managed_bundle: { id: bundle.id, name: bundle.name },
		service_level: contract
			? { id: contract.service_level_id, name: contract.service_level_name }
			: null,
	}
}
