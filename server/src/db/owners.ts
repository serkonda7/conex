/**
 * Parent-tenant resolvers for tenant-less child rows: shelves follow their
 * rack, interfaces their device, cables both endpoint devices, attachments
 * their owning site, location or rack.
 * `undefined` means the row (or its parent) does not exist; callers then
 * fall through to the normal 404 path instead of inventing a 403.
 */
import { asc, eq, inArray } from 'drizzle-orm'
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core'
import {
	type cables,
	devices,
	employee_tenants,
	employees,
	interfaces,
	locations,
	racks,
	shelves,
	sites,
} from '../schema'
import { getDb } from './connection'

type Tenant = number | null | undefined
type TenantTable = PgTable & { id: PgColumn; tenant_id: PgColumn }

/** Tenant of row `id` of `table`, or `undefined` when the row is missing. */
async function tenantIdOf(table: TenantTable, id: number): Promise<Tenant> {
	const rows = await getDb()
		.select({ tenant_id: table.tenant_id })
		.from(table)
		.where(eq(table.id, id))
		.limit(1)
	return rows[0]?.tenant_id as Tenant
}

/** Tenant of a site, or `undefined` when the site is missing. */
function siteTenant(siteId: number): Promise<Tenant> {
	return tenantIdOf(sites, siteId)
}

/** Tenant of a location, or `undefined` when the location is missing. */
function locationTenant(locationId: number): Promise<Tenant> {
	return tenantIdOf(locations, locationId)
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

/** Tenant of a rack, or `undefined` when the rack is missing. */
export function rackTenant(rackId: number): Promise<Tenant> {
	return tenantIdOf(racks, rackId)
}

/** Tenant of a device, or `undefined` when the device is missing. */
export function deviceTenant(deviceId: number): Promise<Tenant> {
	return tenantIdOf(devices, deviceId)
}

/**
 * Tenants of an employee in membership order (first = primary), or
 * `undefined` when the employee is missing.
 */
export async function employeeTenants(employeeId: number): Promise<number[] | undefined> {
	const rows = await getDb()
		.select({ id: employees.id, tenant_id: employee_tenants.tenant_id })
		.from(employees)
		.leftJoin(employee_tenants, eq(employee_tenants.employee_id, employees.id))
		.where(eq(employees.id, employeeId))
		.orderBy(asc(employee_tenants.position))
	if (rows.length === 0) {
		return undefined
	}
	return rows.map((r) => r.tenant_id).filter((t): t is number => t !== null)
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
	const rows = await getDb()
		.select({ id: interfaces.id, tenant_id: devices.tenant_id })
		.from(interfaces)
		.innerJoin(devices, eq(devices.id, interfaces.device_id))
		.where(inArray(interfaces.id, [cable.a_interface_id, cable.b_interface_id]))
	const tenantOf = (id: number): number | null =>
		rows.find((row) => row.id === id)?.tenant_id ?? null
	return [tenantOf(cable.a_interface_id), tenantOf(cable.b_interface_id)]
}
