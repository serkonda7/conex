import { createMemo, type JSX } from 'solid-js'
import {
	delete_location,
	fetch_locations,
	fetch_sites,
	fetch_tenants,
	type LocationRow,
	type LocationSort,
} from '../../api/tenancy'
import type { DataTableColumn } from '../../components/data_table'
import { IconLabel } from '../../components/icon_label'
import {
	EntityListPage,
	idOptions,
	idsOf,
	useEntityList,
	useQueryFilter,
	useQueryFilterList,
} from '../../components/list_page'
import { TreeName, treeDepths } from '../../components/tree_name'
import { t, tp } from '../../i18n'
import { locationTypeLabel } from '../../i18n/labels'
import { locationTypeIcon } from '../../lib/icons'
import { useNameOf } from '../../lib/lookup'
import { createRows } from '../../lib/resource'
import { parseId } from '../../lib/router'
import { tenantContext, tenantContextFilters } from '../../lib/tenant_context'

/** Location name indented by its depth in the site's location tree. */
export function LocationTreeName(props: { location: LocationRow; depth: number }): JSX.Element {
	return (
		<TreeName depth={props.depth}>
			<a href={`/locations/${props.location.id}`}>{props.location.name}</a>
		</TreeName>
	)
}

/**
 * /locations — NetBox-style location list: search, sortable columns, site +
 * tenant filters (deep-linkable via `?site=<id>` / `?tenant=<id>`), and icon
 * actions with delete in a row menu.
 */
export function LocationsPage(): JSX.Element {
	const [filterSite, setFilterSite] = useQueryFilterList('site')
	const [filterTenant] = useQueryFilter('tenant')
	const list = useEntityList({
		noun: 'noun.location',
		sort: 'name' as LocationSort,
		filters: () => ({
			site: idsOf(filterSite()),
			...tenantContextFilters(parseId(filterTenant()) ?? undefined),
		}),
		fetch: fetch_locations,
		remove: delete_location,
	})
	const [sites] = createRows(fetch_sites, list.setError)
	const [tenants] = createRows(fetch_tenants, list.setError)
	const siteName = useNameOf(sites)
	const tenantName = useNameOf(tenants)
	// The optional Parent column resolves names from the listed rows.
	const parentName = useNameOf(list.rows)
	// Show the hierarchy by indenting instead of spending a column on it.
	const depthOf = createMemo(() => treeDepths(list.rows()))

	const columns: DataTableColumn<LocationRow>[] = [
		{
			key: 'name',
			label: tp('entity.location', 1),
			sortable: true,
			getValue: (l: LocationRow): JSX.Element => (
				<LocationTreeName location={l} depth={depthOf().get(l.id) ?? 0} />
			),
		},
		{
			key: 'type',
			label: t('common.type'),
			getValue: (l: LocationRow): JSX.Element => (
				<IconLabel icon={locationTypeIcon(l.type)}>{locationTypeLabel(l.type)}</IconLabel>
			),
		},
		{
			key: 'site',
			label: tp('entity.site', 1),
			getValue: (l: LocationRow): string => siteName(l.site_id),
		},
		{
			key: 'parent',
			label: t('site.parentLocation'),
			getValue: (l: LocationRow): string => parentName(l.parent_id),
		},
		{
			key: 'tenant',
			label: tp('entity.tenant', 1),
			getValue: (l: LocationRow): string => tenantName(l.tenant_id),
		},
	]

	return (
		<EntityListPage
			list={list}
			title={tp('entity.location', 2)}
			addHref="/locations/add"
			filters={[
				{
					key: 'site',
					label: tp('entity.site', 1),
					options: idOptions(sites()),
					value: filterSite,
					onChange: setFilterSite,
				},
			]}
			filtered={filterTenant() !== '' || tenantContext().kind !== 'all'}
			columns={columns}
			columnsKey="locations"
			defaultColumns={['name', 'type', 'site']}
			rowName={(l: LocationRow): string => l.name}
			editHref={(l: LocationRow): string => `/locations/${l.id}/edit`}
			emptyText={t('location.empty')}
		/>
	)
}
