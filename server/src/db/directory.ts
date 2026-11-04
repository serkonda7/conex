import { and, asc, eq, sql } from 'drizzle-orm'
import { extensionNumber, normalizePhone } from 'shared/src/phone'
import {
	type DirectoryContact,
	type EmployeePhone,
	type PhoneType,
	primaryPhone,
	type TenantPhone,
} from 'shared/src/schemas'
import { employee_tenants, employees, tenants } from '../schema'
import { getDb } from './connection'
import { inTenants } from './list'

// ---------------------------------------------------------------------------
// Contact directory: active employees with their tenant, shaped for
// telephony lookups (AGFEO Dashboard LDAP plugin).
// ---------------------------------------------------------------------------

/**
 * Normalized numbers of `type` and `scope`. Extensions count as `phone` and
 * are completed with the tenant's main number; unresolvable ones are dropped.
 */
function numbers(
	phones: readonly EmployeePhone[],
	tenantPhones: readonly TenantPhone[],
	type: Exclude<PhoneType, 'extension'>,
	scope: EmployeePhone['scope'],
): string[] {
	const main = primaryPhone(tenantPhones, 'phone')
	return phones
		.filter(
			(p) =>
				p.scope === scope &&
				(p.type === type || (type === 'phone' && p.type === 'extension')),
		)
		.map((p) =>
			p.type === 'extension' ? extensionNumber(p.number, main) : normalizePhone(p.number),
		)
		.filter((n): n is string => !!n)
}

/**
 * All active employees under their primary tenant; for a scoped requester
 * those of its tenants, each under its first tenant in scope.
 */
export async function listDirectoryContacts(
	tenantScope?: readonly number[],
): Promise<DirectoryContact[]> {
	const rows = await getDb()
		.select({
			id: employees.id,
			customer_number: tenants.customer_number,
			company: tenants.name,
			first_name: employees.first_name,
			last_name: employees.last_name,
			name: employees.name,
			title: employees.title,
			emails: employees.emails,
			phones: employees.phones,
			tenant_phones: tenants.phones,
		})
		.from(employees)
		.innerJoin(
			employee_tenants,
			and(
				eq(employee_tenants.employee_id, employees.id),
				tenantScope !== undefined
					? sql`${employee_tenants.position} = (
						select min("st"."position") from ${employee_tenants} as "st"
						where "st"."employee_id" = ${employees}."id"
							and ${inTenants(sql`"st"."tenant_id"`, tenantScope)}
					)`
					: eq(employee_tenants.position, 0),
			),
		)
		.innerJoin(tenants, eq(tenants.id, employee_tenants.tenant_id))
		.where(eq(employees.active, 1))
		.orderBy(asc(employees.name), asc(employees.id))
	return rows.map(({ emails, phones, tenant_phones, ...row }) => {
		const business = numbers(phones, tenant_phones, 'phone', 'work')
		const home = numbers(phones, tenant_phones, 'phone', 'private')
		const mobile = numbers(phones, tenant_phones, 'mobile', 'work')
		const mobileHome = numbers(phones, tenant_phones, 'mobile', 'private')
		return {
			...row,
			email: emails[0]?.address ?? null,
			phone_business: business[0] ?? null,
			phone_business2: business[1] ?? null,
			phone_home: home[0] ?? null,
			phone_home2: home[1] ?? null,
			phone_mobile: mobile[0] ?? null,
			phone_mobile2: mobile[1] ?? null,
			phone_mobile_home: mobileHome[0] ?? null,
			phone_mobile_home2: mobileHome[1] ?? null,
		}
	})
}
