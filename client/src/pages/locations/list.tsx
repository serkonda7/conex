import type { JSX } from 'solid-js'
import {
	delete_location,
	fetch_locations,
	fetch_sites,
	type LocationListRow,
	type LocationRow,
	type LocationSort,
	type LocationType,
} from '../../api/tenancy'
import { type DataTableColumn, descriptionColumn } from '../../components/data_table'
import { IconLabel } from '../../components/icon_label'
import {
	EntityListPage,
	idOptions,
	idsOf,
	useEntityList,
	useQueryFilter,
	useQueryFilterList,
} from '../../components/list_page'
import { TreeName, type TreeToggle } from '../../components/tree_name'
import { t, tp } from '../../i18n'
import { locationTypeLabel, locationTypeOptions } from '../../i18n/labels'
import { createCollapsedTree } from '../../lib/collapsed_tree'
import { locationTypeIcon } from '../../lib/icons'
import { createRowsFor } from '../../lib/resource'
import { parseId } from '../../lib/router'
import { tenantContext, tenantContextFilters } from '../../lib/tenant_context'

/** Location name indented by its depth in the site's location tree. */
export function LocationTreeName(props: {
	location: LocationRow
	depth: number
	toggle?: TreeToggle
}): JSX.Element {
	return (
		<TreeName depth={props.depth} toggle={props.toggle}>
			<a href={`/locations/${props.location.id}`}>{props.location.name}</a>
		</TreeName>
	)
}

/**
 * /locations — NetBox-style location list: search, sortable columns, nested
 * locations indented under their parent and collapsible, type and site
 * filters (site options limited to the active tenant), site + tenant deep
 * links (`?site=<id>` / `?tenant=<id>`), and icon actions with delete in a
 * row menu.
 */
export function LocationsPage(): JSX.Element {
	const [filterType, setFilterType] = useQueryFilterList('type')
	const [filterSite, setFilterSite] = useQueryFilterList('site')
	const [filterTenant] = useQueryFilter('tenant')
	const tree = createCollapsedTree('locations')
	const list = useEntityList({
		noun: 'noun.location',
		sort: 'name' as LocationSort,
		filters: () => ({
			site: idsOf(filterSite()),
			type: filterType().length > 0 ? (filterType() as LocationType[]) : undefined,
			...tenantContextFilters(parseId(filterTenant()) ?? undefined),
		}),
		fetch: fetch_locations,
		remove: delete_location,
	})
	// Site options follow the tenant (page `?tenant=` or tenant context).
	const [sites] = createRowsFor(
		() => tenantContextFilters(parseId(filterTenant()) ?? undefined),
		fetch_sites,
		list.setError,
	)

	const columns: DataTableColumn<LocationListRow>[] = [
		{
			key: 'name',
			label: tp('entity.location', 1),
			sortable: true,
			getValue: (l: LocationListRow): JSX.Element => (
				<LocationTreeName
					location={l}
					depth={l.depth}
					toggle={{
						hasChildren: l.child_count > 0,
						collapsed: tree.isCollapsed(l.id),
						label: t(tree.isCollapsed(l.id) ? 'tree.expand' : 'tree.collapse', {
							name: l.name,
						}),
						onToggle: (): void => tree.toggle(l.id),
					}}
				/>
			),
		},
		{
			key: 'type',
			label: t('common.type'),
			sortable: true,
			getValue: (l: LocationListRow): JSX.Element => (
				<IconLabel icon={locationTypeIcon(l.type)}>{locationTypeLabel(l.type)}</IconLabel>
			),
		},
		{
			key: 'site',
			label: tp('entity.site', 1),
			sortable: true,
			getValue: (l: LocationListRow): JSX.Element => (
				<a href={`/sites/${l.site_id}`}>{l.site_name}</a>
			),
		},
		descriptionColumn({ sortable: true }),
		{
			key: 'tenant',
			label: tp('entity.tenant', 1),
			sortable: true,
			getValue: (l: LocationListRow): JSX.Element =>
				l.tenant_id === null ? (
					<span>—</span>
				) : (
					<a href={`/tenants/${l.tenant_id}`}>{l.tenant_name}</a>
				),
		},
	]

	return (
		<EntityListPage
			list={{ ...list, rows: (): LocationListRow[] => tree.visible(list.rows()) }}
			title={tp('entity.location', 2)}
			addHref="/locations/add"
			filters={[
				{
					key: 'type',
					label: t('common.type'),
					options: locationTypeOptions(),
					value: filterType,
					onChange: setFilterType,
				},
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
