import { Result } from 'better-result'
import { and, eq, isNull, type SQL } from 'drizzle-orm'
import type { VirtualMachineCreate, VirtualMachineUpdate } from 'shared/src/schemas'
import { device_roles, devices, virtual_machines } from '../schema'
import { logCreate, logDelete, logUpdate } from './changelog'
import { getDb } from './connection'
import { checkDeviceRoleExists } from './device_roles'
import { checkEmployeeAssignment } from './employees'
import { ConflictError, NotFoundError, ValidationError } from './errors'
import {
	checkTenantExists,
	exists,
	findById,
	findOne,
	insertedId,
	isPatchEmpty,
	isTaken,
	pickDefined,
	tryWrite,
} from './list'

export type VirtualMachineRow = typeof virtual_machines.$inferSelect

// ---------------------------------------------------------------------------
// Virtual machines: run on a host device or have no host (cloud / IaaS).
// A hosted VM carries its host's tenant (copied on create and host change,
// re-synced by `retenantHostedVms` when the host moves tenant); a client
// `tenant_id` for a hosted VM is rejected. A detached VM keeps its tenant.
// Names are unique per host; hostless VMs are unique per tenant (or among
// the hostless VMs without a tenant).
// ---------------------------------------------------------------------------

const NAME_IN_USE_ON_HOST = 'This host already runs a virtual machine with this name'
const NAME_IN_USE_HOSTLESS = 'A virtual machine without host already uses this name'
const TENANT_FROM_HOST = 'A virtual machine on a host takes its tenant from the host'
const HOST_ROLE_CANNOT_HOST = "The host device's role cannot host virtual machines"

/**
 * Tenant of the host device, or a `NotFoundError` when it is missing. A newly
 * picked host (`newHost`) must have a role that can host VMs; VMs already on
 * a host stay valid when its role loses the flag.
 */
async function hostTenant(hostId: number, newHost: boolean): Promise<Result<number | null, Error>> {
	const host = await findOne(devices, eq(devices.id, hostId))
	if (!host) {
		return Result.err(new NotFoundError('Host device not found'))
	}
	if (newHost) {
		const role = await findOne(device_roles, eq(device_roles.id, host.device_role_id))
		if (role?.can_host_vms !== 1) {
			return Result.err(new ValidationError(HOST_ROLE_CANNOT_HOST))
		}
	}
	return Result.ok(host.tenant_id)
}

/** Rows a VM name collides with: same host, or same tenant among hostless VMs. */
function nameScope(name: string, hostId: number | null, tenantId: number | null): SQL | undefined {
	if (hostId !== null) {
		return and(eq(virtual_machines.host_device_id, hostId), eq(virtual_machines.name, name))
	}
	return and(
		isNull(virtual_machines.host_device_id),
		tenantId === null
			? isNull(virtual_machines.tenant_id)
			: eq(virtual_machines.tenant_id, tenantId),
		eq(virtual_machines.name, name),
	)
}

async function checkNameFree(
	name: string,
	hostId: number | null,
	tenantId: number | null,
	excludeId?: number,
): Promise<Result<undefined, Error>> {
	if (await isTaken(virtual_machines, nameScope(name, hostId, tenantId), excludeId)) {
		return Result.err(
			new ConflictError(hostId === null ? NAME_IN_USE_HOSTLESS : NAME_IN_USE_ON_HOST),
		)
	}
	return Result.ok(undefined)
}

/** Maps a VM unique violation to the colliding name scope (host vs hostless). */
function duplicateNameError(err: unknown): Error {
	const message = err instanceof Error ? err.message : String(err)
	return new ConflictError(
		message.includes('virtual_machines_host_name_idx')
			? NAME_IN_USE_ON_HOST
			: NAME_IN_USE_HOSTLESS,
	)
}

export function getVirtualMachine(id: number): Promise<Result<VirtualMachineRow, Error>> {
	return findById(virtual_machines, id, 'Virtual machine not found')
}

/** Whether any VM runs on the device (device delete guard). */
export function deviceHasVirtualMachines(deviceId: number): Promise<boolean> {
	return exists(virtual_machines, eq(virtual_machines.host_device_id, deviceId))
}

export async function createVirtualMachine(
	input: VirtualMachineCreate,
): Promise<Result<VirtualMachineRow, Error>> {
	const hostId = input.host_device_id ?? null
	let tenantId = input.tenant_id ?? null
	if (hostId !== null) {
		if (input.tenant_id !== undefined) {
			return Result.err(new ValidationError(TENANT_FROM_HOST))
		}
		const tenant = await hostTenant(hostId, true)
		if (Result.isError(tenant)) {
			return tenant
		}
		tenantId = tenant.value
	}
	for (const guard of [
		await checkTenantExists(tenantId),
		await checkEmployeeAssignment(input.employee_id, tenantId),
		await checkDeviceRoleExists(input.device_role_id),
		await checkNameFree(input.name, hostId, tenantId),
	]) {
		if (Result.isError(guard)) {
			return guard
		}
	}
	const values: Omit<VirtualMachineRow, 'id'> = {
		host_device_id: hostId,
		device_role_id: input.device_role_id,
		status: input.status ?? 'active',
		name: input.name,
		tenant_id: tenantId,
		employee_id: input.employee_id ?? null,
		description: input.description ?? null,
	}
	const id = await tryWrite(
		async () =>
			insertedId(
				await getDb()
					.insert(virtual_machines)
					.values(values)
					.returning({ id: virtual_machines.id }),
			),
		duplicateNameError,
	)
	if (Result.isError(id)) {
		return id
	}
	return await logCreate('virtual_machine', await getVirtualMachine(id.value))
}

export async function updateVirtualMachine(
	id: number,
	input: VirtualMachineUpdate,
): Promise<Result<VirtualMachineRow, Error>> {
	const current = await getVirtualMachine(id)
	if (Result.isError(current)) {
		return current
	}
	const node = current.value
	const hostId = input.host_device_id !== undefined ? input.host_device_id : node.host_device_id
	let tenantId = input.tenant_id !== undefined ? input.tenant_id : node.tenant_id
	if (hostId !== null) {
		if (input.tenant_id !== undefined) {
			return Result.err(new ValidationError(TENANT_FROM_HOST))
		}
		const tenant = await hostTenant(hostId, hostId !== node.host_device_id)
		if (Result.isError(tenant)) {
			return tenant
		}
		tenantId = tenant.value
	}
	const tenantChanged = tenantId !== node.tenant_id
	// The old employee no longer belongs to a new tenant.
	const employeeId =
		input.employee_id !== undefined
			? input.employee_id
			: tenantChanged
				? null
				: node.employee_id
	const name = input.name ?? node.name
	for (const guard of [
		await checkTenantExists(tenantChanged ? tenantId : undefined),
		await checkEmployeeAssignment(employeeId, tenantId),
		await checkNameFree(name, hostId, tenantId, id),
	]) {
		if (Result.isError(guard)) {
			return guard
		}
	}
	if (input.device_role_id !== undefined) {
		const roleCheck = await checkDeviceRoleExists(input.device_role_id)
		if (Result.isError(roleCheck)) {
			return roleCheck
		}
	}
	const patch: Partial<VirtualMachineRow> = pickDefined(input, [
		'host_device_id',
		'device_role_id',
		'name',
		'status',
		'description',
	])
	if (tenantChanged) {
		patch.tenant_id = tenantId
	}
	if (employeeId !== node.employee_id) {
		patch.employee_id = employeeId
	}
	if (!isPatchEmpty(patch)) {
		const written = await tryWrite(
			() => getDb().update(virtual_machines).set(patch).where(eq(virtual_machines.id, id)),
			duplicateNameError,
		)
		if (Result.isError(written)) {
			return written
		}
	}
	return await logUpdate('virtual_machine', node, await getVirtualMachine(id))
}

export async function deleteVirtualMachine(id: number): Promise<Result<VirtualMachineRow, Error>> {
	const current = await getVirtualMachine(id)
	if (Result.isError(current)) {
		return current
	}
	const deleted = await tryWrite(() =>
		getDb().delete(virtual_machines).where(eq(virtual_machines.id, id)),
	)
	if (Result.isError(deleted)) {
		return deleted
	}
	return await logDelete('virtual_machine', current.value)
}

/**
 * Moves the VMs of a host to its new tenant and clears their employee (who
 * belongs to the old tenant). Runs on the caller's `getDb()`, so inside
 * `withTransaction` it commits with the host's own tenant change.
 */
export async function retenantHostedVms(hostId: number, tenantId: number | null): Promise<void> {
	const db = getDb()
	const hosted = eq(virtual_machines.host_device_id, hostId)
	const moved = await db.select().from(virtual_machines).where(hosted)
	if (moved.length === 0) {
		return
	}
	await db.update(virtual_machines).set({ tenant_id: tenantId, employee_id: null }).where(hosted)
	for (const vm of moved) {
		await logUpdate('virtual_machine', vm, await getVirtualMachine(vm.id))
	}
}
