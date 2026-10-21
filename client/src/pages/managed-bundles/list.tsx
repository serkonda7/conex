import type { JSX } from 'solid-js'
import {
	delete_managed_bundle,
	fetch_managed_bundles,
	type ManagedBundleListRow,
	type ManagedBundleSort,
} from '../../api/service_catalog'
import { descriptionColumn, nameColumn } from '../../components/data_table'
import { EntityListPage, type ListTab, useEntityList } from '../../components/list_page'
import { t, tp } from '../../i18n'

/** Managed bundles ↔ service levels ↔ priorities tabs. */
export function managedServiceTabs(
	active: 'managed-bundles' | 'service-levels' | 'priorities',
): ListTab[] {
	return [
		{
			label: tp('entity.managedBundle', 2),
			href: '/managed-bundles',
			active: active === 'managed-bundles',
		},
		{
			label: tp('entity.serviceLevel', 2),
			href: '/service-levels',
			active: active === 'service-levels',
		},
		{ label: tp('entity.priority', 2), href: '/priorities', active: active === 'priorities' },
	]
}

/**
 * /managed-bundles — managed-service bundle list: search, sortable columns,
 * how many device roles map onto each bundle and how many tenants contract it.
 */
export function ManagedBundlesPage(): JSX.Element {
	const list = useEntityList({
		noun: 'noun.managedBundle',
		sort: 'name' as ManagedBundleSort,
		fetch: fetch_managed_bundles,
		remove: delete_managed_bundle,
	})

	return (
		<EntityListPage
			list={list}
			title={tp('entity.managedBundle', 2)}
			tabs={managedServiceTabs('managed-bundles')}
			addHref="/managed-bundles/add"
			columns={[
				nameColumn<ManagedBundleListRow>(t('common.name'), '/managed-bundles', {
					sortable: true,
				}),
				descriptionColumn({ sortable: true }),
				{
					key: 'role_count',
					label: t('managedBundle.roleCount'),
					getValue: (r: ManagedBundleListRow): string => String(r.role_count),
				},
				{
					key: 'tenant_count',
					label: t('managedBundle.tenantCount'),
					getValue: (r: ManagedBundleListRow): string => String(r.tenant_count),
				},
			]}
			columnsKey="managed-bundles"
			rowName={(r: ManagedBundleListRow): string => r.name}
			editHref={(r: ManagedBundleListRow): string => `/managed-bundles/${r.id}/edit`}
			emptyText={t('managedBundle.empty')}
		/>
	)
}
