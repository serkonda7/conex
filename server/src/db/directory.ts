import { and, asc, eq } from 'drizzle-orm'
import { normalizePhone } from 'shared/src/phone'
import type { DirectoryContact, EmployeePhone, PhoneType } from 'shared/src/schemas'
import { employees, tenants } from '../schema'
import { getDb } from './connection'

// ---------------------------------------------------------------------------
// Contact directory: active employees with their tenant, shaped for
// telephony lookups (AGFEO Dashboard LDAP plugin).
// ---------------------------------------------------------------------------

/** `pos`-th (0-based) number of `type` (and `scope`, if given), normalized. */
function phone(
	phones: readonly EmployeePhone[],
	type: PhoneType,
	scope: EmployeePhone['scope'] | null,
	pos: number,
): string | null {
	const number = phones.filter((p) => p.type === type && (scope === null || p.scope === scope))[
		pos
	]?.number
	return number ? normalizePhone(number) || null : null
}

/** All active employees, or those of one tenant for a scoped requester. */
export async function listDirectoryContacts(tenantScope?: number): Promise<DirectoryContact[]> {
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
		})
		.from(employees)
		.innerJoin(tenants, eq(tenants.id, employees.tenant_id))
		.where(
			and(
				eq(employees.active, 1),
				tenantScope !== undefined ? eq(employees.tenant_id, tenantScope) : undefined,
			),
		)
		.orderBy(asc(employees.name), asc(employees.id))
	return rows.map(({ emails, phones, ...row }) => ({
		...row,
		email: emails[0]?.address ?? null,
		phone_business: phone(phones, 'phone', 'work', 0),
		phone_business2: phone(phones, 'phone', 'work', 1),
		phone_home: phone(phones, 'phone', 'private', 0),
		phone_home2: phone(phones, 'phone', 'private', 1),
		phone_mobile: phone(phones, 'mobile', null, 0),
		phone_mobile2: phone(phones, 'mobile', null, 1),
	}))
}
