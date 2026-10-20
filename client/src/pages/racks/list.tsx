import type { JSX } from 'solid-js'
import { delete_rack, fetch_racks, type RackRow, type RackSort } from '../../api/racks'
import { fetch_device_types } from '../../api/templates'
import { fetch_locations, fetch_sites, fetch_tenants } from '../../api/tenancy'
import { type DataTableColumn, descriptionColumn, nameColumn } from '../../components/data_table'
import {
	EntityListPage,
	idOptions,
	idsOf,
	useEntityList,
	useQueryFilter,
	useQueryFilterList,
} from '../../components/list_page'
import { t, tp } from '../../i18n'
import { useNameOf } from '../../lib/lookup'
import { createRows, createRowsFor } from '../../lib/resource'
import { parseId } from '../../lib/router'
import { tenantContext, tenantContextFilters } from '../../lib/tenant_context'

/**
 * /racks — NetBox-style rack list: search, sortable columns, site /
 * location / tenant filters (deep-linkable via `?site=<id>` /
 * `?location=<id>` / `?tenant=<id>`), and
 * icon actions with delete in a row menu.
 */
export function RacksPage(): JSX.Element {
	const [filterSite, setFilterSite] = useQueryFilterList('site')
	const [filterLocation, setFilterLocation] = useQueryFilterList('location')
	const [filterTenant] = useQueryFilter('tenant')
	const list = useEntityList({
		noun: 'noun.rack',
		sort: 'name' as RackSort,
		filters: () => ({
			site: idsOf(filterSite()),
			location: idsOf(filterLocation()),
			...tenantContextFilters(parseId(filterTenant()) ?? undefined),
		}),
		fetch: fetch_racks,
		remove: delete_rack,
	})
	const [sites] = createRows(fetch_sites, list.setError)
	const [tenants] = createRows(fetch_tenants, list.setError)
	// Location filter options follow the site filter; the table resolves
	// location names from the same list.
	const [locations] = createRowsFor(
		() => ({ site: idsOf(filterSite()) }),
		fetch_locations,
		list.setError,
	)
	const [rackTypes] = createRows(() => fetch_device_types({ kind: 'rack' }))
	const siteName = useNameOf(sites)
	const locationName = useNameOf(locations)
	const tenantName = useNameOf(tenants)
	const rackTypeName = useNameOf(rackTypes, (type) => type.model)

	// Changing the site resets a location that belongs to another site.
	function handleSiteFilter(value: string[]): void {
		setFilterSite(value)
		setFilterLocation([])
	}

	const columns: DataTableColumn<RackRow>[] = [
		nameColumn(tp('entity.rack', 1), '/racks', { sortable: true }),
		{
			key: 'site',
			label: tp('entity.site', 1),
			getValue: (r: RackRow): string => siteName(r.site_id),
		},
		{
			key: 'location',
			label: tp('entity.location', 1),
			getValue: (r: RackRow): string => locationName(r.location_id),
		},
		descriptionColumn(),
		{
			key: 'type',
			label: t('common.type'),
			getValue: (r: RackRow): string => rackTypeName(r.rack_type_id),
		},
		{
			key: 'tenant',
			label: tp('entity.tenant', 1),
			getValue: (r: RackRow): string => tenantName(r.tenant_id),
		},
	]

	return (
		<EntityListPage
			list={list}
			title={tp('entity.rack', 2)}
			addHref="/racks/add"
			filters={[
				{
					key: 'site',
					label: tp('entity.site', 1),
					options: idOptions(sites()),
					value: filterSite,
					onChange: handleSiteFilter,
				},
				{
					key: 'location',
					label: tp('entity.location', 1),
					options: idOptions(locations()),
					value: filterLocation,
					onChange: setFilterLocation,
				},
			]}
			filtered={filterTenant() !== '' || tenantContext().kind !== 'all'}
			columns={columns}
			columnsKey="racks"
			defaultColumns={['name', 'site', 'location', 'description', 'type']}
			rowName={(r: RackRow): string => r.name}
			editHref={(r: RackRow): string => `/racks/${r.id}/edit`}
			emptyText={t('rack.empty')}
		/>
	)
}
