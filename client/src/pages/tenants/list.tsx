import type { JSX } from 'solid-js'
import {
	delete_tenant,
	fetch_tenant_groups,
	fetch_tenants,
	type TenantSort,
	type TenantWithCounts,
} from '../../api/tenancy'
import { CountLink, type DataTableColumn, nameColumn } from '../../components/data_table'
import {
	EntityListPage,
	idOptions,
	idsOf,
	useEntityList,
	useQueryFilterList,
} from '../../components/list_page'
import { t, tp } from '../../i18n'
import { useNameOf } from '../../lib/lookup'
import { createRows } from '../../lib/resource'
import { contextGroupId } from '../../lib/tenant_context'

/**
 * /tenants — NetBox-style tenant list: search, sortable columns with the
 * related-object counts, tenant group filter (deep-linkable via
 * `?group=<id>`, else the top-bar group context), and icon actions with
 * delete in a row menu.
 */
export function TenantsPage(): JSX.Element {
	const [filterGroup, setFilterGroup] = useQueryFilterList('group')
	const group = (): number[] | undefined => {
		const context = contextGroupId()
		return idsOf(filterGroup()) ?? (context === undefined ? undefined : [context])
	}
	const list = useEntityList({
		noun: 'noun.tenant',
		sort: 'name' as TenantSort,
		filters: () => ({ group: group() }),
		fetch: fetch_tenants,
		remove: delete_tenant,
	})
	const [groups] = createRows(fetch_tenant_groups, list.setError)
	const groupName = useNameOf(groups)

	const columns: DataTableColumn<TenantWithCounts>[] = [
		nameColumn<TenantWithCounts>(tp('entity.tenant', 1), '/tenants', { sortable: true }),
		{
			key: 'customer_number',
			label: t('tenant.customerNumber'),
			sortable: true,
			getValue: (row: TenantWithCounts): string => row.customer_number ?? '—',
		},
		{
			key: 'group',
			label: tp('entity.tenantGroup', 1),
			sortable: true,
			getValue: (row: TenantWithCounts): string => groupName(row.tenant_group_id),
		},
		{
			key: 'sites',
			label: tp('entity.site', 2),
			sortable: true,
			getValue: (row: TenantWithCounts): JSX.Element => (
				<CountLink count={row.site_count} href={`/sites?tenant=${row.id}`} />
			),
		},
		{
			key: 'racks',
			label: tp('entity.rack', 2),
			sortable: true,
			getValue: (row: TenantWithCounts): JSX.Element => (
				<CountLink count={row.rack_count} href={`/racks?tenant=${row.id}`} />
			),
		},
		{
			key: 'devices',
			label: tp('entity.device', 2),
			sortable: true,
			getValue: (row: TenantWithCounts): JSX.Element => (
				<CountLink count={row.device_count} href={`/devices?tenant=${row.id}`} />
			),
		},
	]
	const tenantsHref = (): string =>
		filterGroup().length === 0
			? '/tenants'
			: `/tenants?group=${encodeURIComponent(filterGroup().join(','))}`

	return (
		<EntityListPage
			list={list}
			title={tp('entity.tenant', 2)}
			tabs={[
				{ label: tp('entity.tenant', 2), href: tenantsHref(), active: true },
				{ label: tp('entity.tenantGroup', 2), href: '/tenant-groups', active: false },
			]}
			addHref="/tenants/add"
			filters={[
				{
					key: 'group',
					label: tp('entity.tenantGroup', 1),
					options: idOptions(groups()),
					value: filterGroup,
					onChange: setFilterGroup,
				},
			]}
			filtered={contextGroupId() !== undefined}
			columns={columns}
			columnsKey="tenants"
			defaultColumns={['name', 'customer_number', 'group']}
			rowName={(row: TenantWithCounts): string => row.name}
			editHref={(row: TenantWithCounts): string => `/tenants/${row.id}/edit`}
			emptyText={t('tenant.empty')}
		/>
	)
}
