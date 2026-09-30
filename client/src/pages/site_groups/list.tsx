import type { JSX } from 'solid-js'
import {
	delete_site_group,
	fetch_site_groups,
	fetch_tenants,
	type SiteGroupRow,
	type SiteGroupSort,
} from '../../api/tenancy'
import { descriptionColumn, nameColumn } from '../../components/data_table'
import { EntityListPage, useEntityList, useQueryFilter } from '../../components/list_page'
import { t, tp } from '../../i18n'
import { useNameOf } from '../../lib/lookup'
import { createRows } from '../../lib/resource'
import { parseId } from '../../lib/router'
import { tenantContext, tenantContextFilters } from '../../lib/tenant_context'

/**
 * /site-groups — flat site group list: search, sortable columns, tenant
 * filter (deep-linkable via `?tenant=<id>`), row selection with bulk
 * delete, and icon actions with delete in a row menu.
 */
export function SiteGroupsPage(): JSX.Element {
	const [filterTenant] = useQueryFilter('tenant')
	const list = useEntityList({
		noun: 'noun.siteGroup',
		sort: 'name' as SiteGroupSort,
		filters: () => tenantContextFilters(parseId(filterTenant()) ?? undefined),
		fetch: fetch_site_groups,
		remove: delete_site_group,
	})
	const [tenants] = createRows(fetch_tenants, list.setError)
	const tenantName = useNameOf(tenants)

	return (
		<EntityListPage
			list={list}
			title={tp('entity.siteGroup', 2)}
			addHref="/site-groups/add"
			searchPlaceholder={t('tenant.searchPlaceholder')}
			filtered={filterTenant() !== '' || tenantContext().kind !== 'all'}
			columns={[
				nameColumn<SiteGroupRow>(t('common.group'), '/site-groups', { sortable: true }),
				descriptionColumn({ sortable: true }),
				{
					key: 'tenant',
					label: tp('entity.tenant', 1),
					getValue: (g: SiteGroupRow): string => tenantName(g.tenant_id),
				},
			]}
			columnsKey="site-groups"
			rowName={(g: SiteGroupRow): string => g.name}
			editHref={(g: SiteGroupRow): string => `/site-groups/${g.id}/edit`}
			emptyText={t('siteGroup.empty')}
		/>
	)
}
