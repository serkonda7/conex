import type { JSX } from 'solid-js'
import {
	delete_tenant,
	fetch_tenant_groups,
	fetch_tenants,
	type TenantSort,
	type TenantWithCounts,
} from '../../api/tenancy'
import { type DataTableColumn, descriptionColumn, nameColumn } from '../../components/data_table'
import { EntityListPage, useEntityList, useQueryFilter } from '../../components/list_page'
import { t, tp } from '../../i18n'
import { useNameOf } from '../../lib/lookup'
import { createRows } from '../../lib/resource'
import { parseId } from '../../lib/router'
import { contextGroupId } from '../../lib/tenant_context'

/**
 * /tenants — NetBox-style tenant list: search, sortable columns, tenant
 * group filter (deep-linkable via `?group=<id>`, else the top-bar group
 * context), and icon actions with delete in a row menu.
 */
export function TenantsPage(): JSX.Element {
	const [filterGroup] = useQueryFilter('group')
	const group = (): number | undefined => parseId(filterGroup()) ?? contextGroupId()
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
		nameColumn(tp('entity.tenant', 1), '/tenants', { sortable: true }),
		descriptionColumn({ sortable: true }),
		{
			key: 'group',
			label: tp('entity.tenantGroup', 1),
			getValue: (row: TenantWithCounts): string => groupName(row.tenant_group_id),
		},
	]
	const tenantsHref = (): string =>
		filterGroup() === '' ? '/tenants' : `/tenants?group=${encodeURIComponent(filterGroup())}`

	return (
		<EntityListPage
			list={list}
			title={tp('entity.tenant', 2)}
			tabs={[
				{ label: tp('entity.tenant', 2), href: tenantsHref(), active: true },
				{ label: tp('entity.tenantGroup', 2), href: '/tenant-groups', active: false },
			]}
			addHref="/tenants/add"
			searchPlaceholder={t('tenant.searchPlaceholder')}
			filtered={group() !== undefined}
			bulkDelete={false}
			columns={columns}
			columnsKey="tenants"
			rowName={(row: TenantWithCounts): string => row.name}
			editHref={(row: TenantWithCounts): string => `/tenants/${row.id}/edit`}
			emptyText={t('tenant.empty')}
		/>
	)
}
