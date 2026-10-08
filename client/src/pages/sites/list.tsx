import type { JSX } from 'solid-js'
import {
	delete_site,
	fetch_site_groups,
	fetch_sites,
	fetch_tenants,
	type SiteRow,
	type SiteSort,
} from '../../api/tenancy'
import { type DataTableColumn, descriptionColumn, nameColumn } from '../../components/data_table'
import {
	EntityListPage,
	type ListTab,
	useEntityList,
	useQueryFilter,
} from '../../components/list_page'
import { t, tp } from '../../i18n'
import { useNameOf } from '../../lib/lookup'
import { createRows } from '../../lib/resource'
import { parseId } from '../../lib/router'
import { tenantContext, tenantContextFilters } from '../../lib/tenant_context'

/** Sites ↔ site groups tabs, carrying the `?tenant=` filter across. */
export function siteTabs(active: 'sites' | 'site-groups', tenant: string): ListTab[] {
	const suffix = tenant === '' ? '' : `?tenant=${encodeURIComponent(tenant)}`
	return [
		{ label: tp('entity.site', 2), href: `/sites${suffix}`, active: active === 'sites' },
		{
			label: tp('entity.siteGroup', 2),
			href: `/site-groups${suffix}`,
			active: active === 'site-groups',
		},
	]
}

/**
 * /sites — NetBox-style site list: search, sortable columns, tenant filter
 * (deep-linkable via `?tenant=<id>`), and icon actions with delete in a row
 * menu.
 */
export function SitesPage(): JSX.Element {
	const [filterTenant] = useQueryFilter('tenant')
	const list = useEntityList({
		noun: 'noun.site',
		sort: 'name' as SiteSort,
		filters: () => tenantContextFilters(parseId(filterTenant()) ?? undefined),
		fetch: fetch_sites,
		remove: delete_site,
	})
	const [tenants] = createRows(fetch_tenants, list.setError)
	// A failed group lookup degrades to raw ids rather than an error.
	const [groups] = createRows(fetch_site_groups)
	const tenantName = useNameOf(tenants)
	const groupName = useNameOf(groups)

	const columns: DataTableColumn<SiteRow>[] = [
		nameColumn(tp('entity.site', 1), '/sites', { sortable: true }),
		descriptionColumn({ sortable: true }),
		{
			key: 'tenant',
			label: tp('entity.tenant', 1),
			getValue: (s: SiteRow): string => tenantName(s.tenant_id),
		},
		{
			key: 'group',
			label: t('common.group'),
			getValue: (s: SiteRow): string => groupName(s.site_group_id),
		},
	]

	return (
		<EntityListPage
			list={list}
			title={tp('entity.site', 2)}
			tabs={siteTabs('sites', filterTenant())}
			addHref="/sites/add"
			searchPlaceholder={t('common.quickSearch')}
			filtered={filterTenant() !== '' || tenantContext().kind !== 'all'}
			columns={columns}
			columnsKey="sites"
			defaultColumns={['name', 'description', 'group']}
			rowName={(s: SiteRow): string => s.name}
			editHref={(s: SiteRow): string => `/sites/${s.id}/edit`}
			emptyText={t('site.empty')}
		/>
	)
}
