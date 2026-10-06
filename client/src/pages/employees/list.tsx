import { primaryEmail, primaryPhone } from 'shared/src/schemas'
import type { JSX } from 'solid-js'
import {
	delete_employee,
	type EmployeeRow,
	type EmployeeSort,
	fetch_employees,
} from '../../api/employees'
import { fetch_tenants } from '../../api/tenancy'
import { type DataTableColumn, descriptionColumn } from '../../components/data_table'
import { EntityListPage, useEntityList, useQueryFilter } from '../../components/list_page'
import { t, tp } from '../../i18n'
import { employeeSalutationLabel } from '../../i18n/labels'
import { useNameOf } from '../../lib/lookup'
import { createRows } from '../../lib/resource'
import { parseId } from '../../lib/router'
import { tenantContext, tenantContextFilters } from '../../lib/tenant_context'

/** Status pill of an employee (active / inactive). */
export function EmployeeStatus(props: { active: number }): JSX.Element {
	return (
		<span class={`badge ${props.active === 1 ? 'badge-active' : 'badge-decommissioned'}`}>
			{props.active === 1 ? t('employee.active') : t('employee.inactive')}
		</span>
	)
}

/** Mail link, or a dash without an address. */
export function EmailLink(props: { email: string | null }): JSX.Element {
	return props.email ? <a href={`mailto:${props.email}`}>{props.email}</a> : '—'
}

/**
 * /employees — contact persons of the tenants: search, sortable columns,
 * tenant filter (deep-linkable via `?tenant=<id>`), row selection with bulk
 * delete, and icon actions with delete in a row menu.
 */
export function EmployeesPage(): JSX.Element {
	const [filterTenant] = useQueryFilter('tenant')
	const list = useEntityList({
		noun: 'noun.employee',
		sort: 'last_name' as EmployeeSort,
		filters: () => tenantContextFilters(parseId(filterTenant()) ?? undefined),
		fetch: fetch_employees,
		remove: delete_employee,
	})
	const [tenants] = createRows(fetch_tenants, list.setError)
	const tenantName = useNameOf(tenants)

	const columns: DataTableColumn<EmployeeRow>[] = [
		{
			key: 'name',
			label: tp('entity.employee', 1),
			sortable: true,
			getValue: (e: EmployeeRow): JSX.Element => <a href={`/employees/${e.id}`}>{e.name}</a>,
		},
		{
			key: 'first_name',
			label: t('employee.firstName'),
			sortable: true,
			getValue: (e: EmployeeRow): string => e.first_name ?? '—',
		},
		{
			key: 'last_name',
			label: t('employee.lastName'),
			sortable: true,
			getValue: (e: EmployeeRow): string => e.last_name,
		},
		{
			key: 'salutation',
			label: t('employee.salutation'),
			getValue: (e: EmployeeRow): string =>
				e.salutation === null ? '—' : employeeSalutationLabel(e.salutation),
		},
		{
			key: 'title',
			label: t('employee.title'),
			sortable: true,
			getValue: (e: EmployeeRow): string => e.title ?? '—',
		},
		{
			key: 'email',
			label: t('employee.email'),
			sortable: true,
			getValue: (e: EmployeeRow): JSX.Element => <EmailLink email={primaryEmail(e.emails)} />,
		},
		{
			key: 'phone',
			label: t('employee.phone'),
			getValue: (e: EmployeeRow): string => primaryPhone(e.phones, 'phone') ?? '—',
		},
		{
			key: 'mobile',
			label: t('employee.mobile'),
			getValue: (e: EmployeeRow): string => primaryPhone(e.phones, 'mobile') ?? '—',
		},
		{
			key: 'tenant',
			label: tp('entity.tenant', 1),
			getValue: (e: EmployeeRow): string => tenantName(e.tenant_id),
		},
		{
			key: 'status',
			label: t('employee.status'),
			getValue: (e: EmployeeRow): JSX.Element => <EmployeeStatus active={e.active} />,
		},
		descriptionColumn(),
	]

	return (
		<EntityListPage
			list={list}
			title={tp('entity.employee', 2)}
			// The filtered tenant is preselected in the add form.
			addHref={filterTenant() ? `/employees/add?tenant=${filterTenant()}` : '/employees/add'}
			searchPlaceholder={t('employee.searchPlaceholder')}
			filtered={filterTenant() !== '' || tenantContext().kind !== 'all'}
			columns={columns}
			columnsKey="employees"
			defaultColumns={['name', 'title', 'email', 'phone', 'mobile', 'status']}
			rowName={(e: EmployeeRow): string => e.name}
			editHref={(e: EmployeeRow): string => `/employees/${e.id}/edit`}
			emptyText={t('employee.empty')}
		/>
	)
}
