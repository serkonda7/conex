import { createSignal, type JSX, Show } from 'solid-js'
import { type FloorplanListJson, type FloorplanSort, fetch_floorplans } from '../../api/attachments'
import { type DataTableColumn, FilterTable } from '../../components/data_table'
import { Empty, InlineError } from '../../components/feedback'
import { ListLoading, useListFilters, useSort, useTableColumns } from '../../components/list_page'
import { t, tp } from '../../i18n'
import { locationTypeLabel } from '../../i18n/labels'
import { usePagedList } from '../../lib/paged_list'
import { tenantContext, tenantContextFilters } from '../../lib/tenant_context'

/**
 * /floorplans — overview of every site and location with a marked floor
 * plan, narrowed by the tenant context, searchable by owner or site name and
 * sortable by owner, type, site and tenant. Each row links to the plan's
 * page, where it is viewed and edited.
 */
export function FloorplansPage(): JSX.Element {
	const [error, setError] = createSignal<string | null>(null)
	const [search, setSearch] = createSignal('')
	const filters = useListFilters<FloorplanListJson>({ search, setSearch })
	const { sort, order, handleSort, clearSort } = useSort<FloorplanSort>(undefined)

	const plans = usePagedList({
		query: () => ({
			search: search(),
			sort: sort(),
			order: order(),
			...tenantContextFilters(),
		}),
		fetch: fetch_floorplans,
		setError,
	})

	const columns: DataTableColumn<FloorplanListJson>[] = [
		{
			key: 'owner',
			label: tp('entity.floorplan', 1),
			sortable: true,
			getValue: (p: FloorplanListJson): JSX.Element => (
				<a href={`/floorplans/${p.attachment_id}`}>{p.owner_name}</a>
			),
		},
		{
			key: 'type',
			label: t('common.type'),
			sortable: true,
			getValue: (p: FloorplanListJson): string =>
				p.location_type === null
					? tp('entity.site', 1)
					: locationTypeLabel(p.location_type),
		},
		{
			key: 'site',
			label: tp('entity.site', 1),
			sortable: true,
			getValue: (p: FloorplanListJson): string => p.site_name,
		},
		{
			key: 'tenant',
			label: tp('entity.tenant', 1),
			sortable: true,
			getValue: (p: FloorplanListJson): JSX.Element => (
				<Show when={p.tenant_id !== null} fallback="—">
					<a href={`/tenants/${p.tenant_id}`}>{p.tenant_name}</a>
				</Show>
			),
		},
		{
			key: 'areas',
			label: t('floorplan.areas'),
			getValue: (p: FloorplanListJson): string => String(p.areas),
		},
		{
			key: 'markers',
			label: t('floorplan.markers'),
			getValue: (p: FloorplanListJson): string => String(p.placements),
		},
	]
	const [visibleColumns, setVisibleColumns] = useTableColumns(
		'floorplans',
		columns.map((c) => c.key),
	)

	const emptyText = (): string =>
		search()
			? t('list.noMatch', { noun: tp('noun.floorplan', 2), search: search() })
			: tenantContext().kind !== 'all'
				? t('list.noMatchFilters', { noun: tp('noun.floorplan', 2) })
				: t('floorplan.listEmpty')

	return (
		<div>
			<div class="page-header">
				<h2>{tp('entity.floorplan', 2)}</h2>
			</div>

			<FilterTable
				rows={plans.rows}
				filters={filters.filters()}
				filterValues={filters.filterValues}
				onFilterValuesChange={filters.onFilterValuesChange}
				savedFiltersKey="floorplans"
				savedLayoutsKey="floorplans"
				manualFiltering
				quickSearchLabel={t('list.searchLabel', { noun: tp('noun.floorplan', 2) })}
				getRowId={(p: FloorplanListJson): number => p.attachment_id}
				columns={columns}
				sortKey={sort}
				sortDirection={order}
				onSort={handleSort}
				onSortClear={clearSort}
				showColumnCustomizer
				visibleColumns={visibleColumns}
				onVisibleColumnsChange={setVisibleColumns}
				pagination={plans.pagination}
				onPaginationChange={plans.onPaginationChange}
				loading={() => plans.page.loading}
				loadingContent={<ListLoading rows={plans.rows()} noun={tp('noun.floorplan', 2)} />}
				emptyContent={<Empty message={emptyText()} />}
			/>

			<InlineError message={error()} />
		</div>
	)
}
