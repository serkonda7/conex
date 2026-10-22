/**
 * Parent-tenant resolvers for tenant-less child rows: shelves follow their
 * rack, interfaces their device, cables both endpoint devices, attachments
 * their owning site, location or rack.
 * `undefined` means the row (or its parent) does not exist; callers then
 * fall through to the normal 404 path instead of inventing a 403.
 */
import { eq } from 'drizzle-orm'
import {
	attachments,
	type cables,
	devices,
	employees,
	interfaces,
	locations,
	racks,
	shelves,
	sites,
	virtual_machines,
} from '../schema'
import { getDb } from './connection'

type Tenant = number | null | undefined

/** Tenant of a site, or `undefined` when the site is missing. */
export async function siteTenant(siteId: number): Promise<Tenant> {
	const rows = await getDb()
		.select({ tenant_id: sites.tenant_id })
		.from(sites)
		.where(eq(sites.id, siteId))
		.limit(1)
	return rows[0]?.tenant_id
}

/** Tenant of a location, or `undefined` when the location is missing. */
export async function locationTenant(locationId: number): Promise<Tenant> {
	const rows = await getDb()
		.select({ tenant_id: locations.tenant_id })
		.from(locations)
		.where(eq(locations.id, locationId))
		.limit(1)
	return rows[0]?.tenant_id
}

/** Tenant of an attachment owner (one of the three ids set), `undefined` when missing. */
export function ownerTenant(owner: {
	site_id?: number | null
	location_id?: number | null
	rack_id?: number | null
}): Promise<Tenant> {
	if (owner.site_id !== undefined && owner.site_id !== null) {
		return siteTenant(owner.site_id)
	}
	if (owner.location_id !== undefined && owner.location_id !== null) {
		return locationTenant(owner.location_id)
	}
	if (owner.rack_id !== undefined && owner.rack_id !== null) {
		return rackTenant(owner.rack_id)
	}
	return Promise.resolve(undefined)
}

/** Tenant of an attachment's owner, or `undefined` when either is missing. */
export async function attachmentTenant(attachmentId: number): Promise<Tenant> {
	const rows = await getDb()
		.select({
			site_id: attachments.site_id,
			location_id: attachments.location_id,
			rack_id: attachments.rack_id,
		})
		.from(attachments)
		.where(eq(attachments.id, attachmentId))
		.limit(1)
	const row = rows[0]
	return row ? ownerTenant(row) : undefined
}

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

/** Tenant of a virtual machine, or `undefined` when the VM is missing. */
export async function virtualMachineTenant(vmId: number): Promise<Tenant> {
	const rows = await getDb()
		.select({ tenant_id: virtual_machines.tenant_id })
		.from(virtual_machines)
		.where(eq(virtual_machines.id, vmId))
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
