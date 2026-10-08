import type { JSX } from 'solid-js'
import {
	delete_tenant_group,
	fetch_tenant_groups,
	type TenantGroupListItem,
	type TenantGroupSort,
} from '../../api/tenancy'
import { descriptionColumn, nameColumn } from '../../components/data_table'
import { EntityListPage, useEntityList } from '../../components/list_page'
import { t, tp } from '../../i18n'

/**
 * /tenant-groups — flat tenant group list: search, sortable columns,
 * member counts.
 */
export function TenantGroupsPage(): JSX.Element {
	const list = useEntityList({
		noun: 'noun.tenantGroup',
		sort: 'name' as TenantGroupSort,
		fetch: fetch_tenant_groups,
		remove: delete_tenant_group,
	})

	return (
		<EntityListPage
			list={list}
			title={tp('entity.tenantGroup', 2)}
			tabs={[
				{ label: tp('entity.tenant', 2), href: '/tenants', active: false },
				{ label: tp('entity.tenantGroup', 2), href: '/tenant-groups', active: true },
			]}
			addHref="/tenant-groups/add"
			searchPlaceholder={t('common.quickSearch')}
			columns={[
				nameColumn<TenantGroupListItem>(tp('entity.tenantGroup', 1), '/tenant-groups', {
					sortable: true,
				}),
				descriptionColumn({ sortable: true }),
				{
					key: 'tenants',
					label: tp('entity.tenant', 2),
					getValue: (row: TenantGroupListItem): JSX.Element => (
						<a href={`/tenants?group=${row.id}`}>{row.tenant_count}</a>
					),
				},
			]}
			columnsKey="tenant-groups"
			rowName={(row: TenantGroupListItem): string => row.name}
			editHref={(row: TenantGroupListItem): string => `/tenant-groups/${row.id}/edit`}
			emptyText={t('tenantGroup.empty')}
		/>
	)
}
