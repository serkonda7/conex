/**
 * Parent-tenant resolvers for tenant-less child rows: shelves follow their
 * rack, interfaces their device, cables both endpoint devices.
 * `undefined` means the row (or its parent) does not exist; callers then
 * fall through to the normal 404 path instead of inventing a 403.
 */
import { eq } from 'drizzle-orm'
import { type cables, devices, employees, interfaces, racks, shelves } from '../schema'
import { getDb } from './connection'

type Tenant = number | null | undefined

/** Tenant of a rack, or `undefined` when the rack is missing. */
export async function rackTenant(rackId: number): Promise<Tenant> {
	const rows = await getDb()
		.select({ tenant_id: racks.tenant_id })
		.from(racks)
		.where(eq(racks.id, rackId))
		.limit(1)
	return rows[0]?.tenant_id
}

/** Tenant of a device, or `undefined` when the device is missing. */
export async function deviceTenant(deviceId: number): Promise<Tenant> {
	const rows = await getDb()
		.select({ tenant_id: devices.tenant_id })
		.from(devices)
		.where(eq(devices.id, deviceId))
		.limit(1)
	return rows[0]?.tenant_id
}

/** Tenant of an employee, or `undefined` when the employee is missing. */
export async function employeeTenant(employeeId: number): Promise<number | undefined> {
	const rows = await getDb()
		.select({ tenant_id: employees.tenant_id })
		.from(employees)
		.where(eq(employees.id, employeeId))
		.limit(1)
	return rows[0]?.tenant_id
}

/** Tenant of a shelf, inherited from its rack; `undefined` when either is missing. */
export async function shelfTenant(shelfId: number): Promise<Tenant> {
	const rows = await getDb()
		.select({ tenant_id: racks.tenant_id })
		.from(shelves)
		.innerJoin(racks, eq(racks.id, shelves.rack_id))
		.where(eq(shelves.id, shelfId))
		.limit(1)
	return rows[0]?.tenant_id
}

/** Tenant of an interface's device, or `undefined` when either is missing. */
export async function interfaceTenant(interfaceId: number): Promise<Tenant> {
	const rows = await getDb()
		.select({ tenant_id: devices.tenant_id })
		.from(interfaces)
		.innerJoin(devices, eq(devices.id, interfaces.device_id))
		.where(eq(interfaces.id, interfaceId))
		.limit(1)
	return rows[0]?.tenant_id
}

/** Tenants of both endpoint devices of a cable row (`null` for a missing end). */
export async function cableTenants(
	cable: Pick<typeof cables.$inferSelect, 'a_interface_id' | 'b_interface_id'>,
): Promise<[number | null, number | null]> {
	return [
		(await interfaceTenant(cable.a_interface_id)) ?? null,
		(await interfaceTenant(cable.b_interface_id)) ?? null,
	]
}
