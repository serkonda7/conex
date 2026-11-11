import { extensionDisplay, normalizePhone } from 'shared/src/phone'
import { primaryEmail, primaryPhone } from 'shared/src/schemas'
import { type JSX, Show } from 'solid-js'
import {
	delete_employee,
	type EmployeeRow,
	type EmployeeSort,
	fetch_employees,
} from '../../api/employees'
import { fetch_tenants } from '../../api/tenancy'
import { CopyValue } from '../../components/copy_value'
import { type DataTableColumn, descriptionColumn } from '../../components/data_table'
import {
	EntityListPage,
	useEntityList,
	useQueryFilter,
	useQueryFilterList,
} from '../../components/list_page'
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

/** Mail link with a copy button, or a dash without an address. */
export function EmailLink(props: { email: string | null }): JSX.Element {
	return (
		<Show when={props.email} fallback="—">
			{(email: () => string): JSX.Element => (
				<CopyValue value={email()}>
					<a href={`mailto:${email()}`}>{email()}</a>
				</CopyValue>
			)}
		</Show>
	)
}

/**
 * Phone number as a `tel:` link (dialing its normalized form) with a copy
 * button, or `—`.
 */
export function PhoneLink(props: { number: string | null }): JSX.Element {
	return (
		<Show when={props.number} fallback="—">
			{(number: () => string): JSX.Element => (
				<CopyValue value={number()}>
					<a href={`tel:${normalizePhone(number())}`}>{number()}</a>
				</CopyValue>
			)}
		</Show>
	)
}

/**
 * /employees — contact persons of the tenants: search, sortable columns, tenant
 * and active/inactive filters (deep-linkable via `?tenant=<id>` and
 * `?active=true`), and icon actions with delete in a
 * row menu.
 */
export function EmployeesPage(): JSX.Element {
	const [filterTenant] = useQueryFilter('tenant')
	const [filterActive, setFilterActive] = useQueryFilterList('active')
	const list = useEntityList({
		noun: 'noun.employee',
		sort: 'last_name' as EmployeeSort,
		filters: () => ({
			...tenantContextFilters(parseId(filterTenant()) ?? undefined),
			// Both values chosen is the same as no filter.
			active:
				filterActive().length === 1 ? (filterActive()[0] as 'true' | 'false') : undefined,
		}),
		fetch: fetch_employees,
		remove: delete_employee,
	})
	const [tenants] = createRows(fetch_tenants, list.setError)
	const tenantName = useNameOf(tenants)
	/**
	 * Work number of an employee: its extension completed with the main number
	 * of its first visible tenant, else its first phone number.
	 */
	const workPhone = (e: EmployeeRow): string | null => {
		const extension = primaryPhone(e.phones, 'extension')
		if (extension === null) {
			return primaryPhone(e.phones, 'phone')
		}
		const tenant = e.tenant_ids
			.map((id) => tenants()?.find((row) => row.id === id))
			.find((row) => row !== undefined)
		return extensionDisplay(extension, primaryPhone(tenant?.phones ?? [], 'phone')) ?? extension
	}

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
			sortable: true,
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
			getValue: (e: EmployeeRow): JSX.Element => <PhoneLink number={workPhone(e)} />,
		},
		{
			key: 'mobile',
			label: t('employee.mobile'),
			getValue: (e: EmployeeRow): JSX.Element => (
				<PhoneLink number={primaryPhone(e.phones, 'mobile')} />
			),
		},
		{
			key: 'tenant',
			label: t('employee.tenants'),
			// Tenants outside the user's scope are not listed.
			getValue: (e: EmployeeRow): string =>
				e.tenant_ids
					.filter((id) => tenants()?.some((row) => row.id === id))
					.map(tenantName)
					.join(', ') || '—',
		},
		{
			key: 'status',
			label: t('common.status'),
			sortable: true,
			getValue: (e: EmployeeRow): JSX.Element => <EmployeeStatus active={e.active} />,
		},
		descriptionColumn({ sortable: true }),
	]

	return (
		<EntityListPage
			list={list}
			title={tp('entity.employee', 2)}
			// The filtered tenant is preselected in the add form.
			addHref={filterTenant() ? `/employees/add?tenant=${filterTenant()}` : '/employees/add'}
			filters={[
				{
					key: 'active',
					label: t('common.status'),
					options: [
						{ value: 'true', label: t('employee.active') },
						{ value: 'false', label: t('employee.inactive') },
					],
					value: filterActive,
					onChange: setFilterActive,
				},
			]}
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
