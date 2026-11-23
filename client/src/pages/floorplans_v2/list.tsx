import { createSignal, type JSX, Show } from 'solid-js'
import {
	type DrawingSort,
	type FloorplanDrawingListJson,
	fetch_drawings,
} from '../../api/floorplan_drawings'
import { type DataTableColumn, FilterTable } from '../../components/data_table'
import { Empty, InlineError } from '../../components/feedback'
import {
	emptyListText,
	ListLoading,
	useListFilters,
	useSort,
	useTableColumns,
} from '../../components/list_page'
import { t, tp } from '../../i18n'
import { locationTypeLabel } from '../../i18n/labels'
import { usePagedList } from '../../lib/paged_list'
import { tenantContext, tenantContextFilters } from '../../lib/tenant_context'

/**
 * /floorplans-v2 — every site and location with a drawn floor plan,
 * narrowed by the tenant context, searchable by owner or site name and
 * sortable by owner, type, site and tenant. Plans are created from their
 * site's or location's page.
 */
export function DrawnFloorplansPage(): JSX.Element {
	const [error, setError] = createSignal<string | null>(null)
	const [search, setSearch] = createSignal('')
	const filters = useListFilters<FloorplanDrawingListJson>({ search, setSearch })
	const { sort, order, handleSort, clearSort } = useSort<DrawingSort>(undefined)

	const plans = usePagedList({
		query: () => ({
			search: search(),
			sort: sort(),
			order: order(),
			...tenantContextFilters(),
		}),
		fetch: fetch_drawings,
		setError,
	})

	const columns: DataTableColumn<FloorplanDrawingListJson>[] = [
		{
			key: 'owner',
			label: tp('entity.drawnFloorplan', 1),
			sortable: true,
			getValue: (p: FloorplanDrawingListJson): JSX.Element => (
				<a href={`/floorplans-v2/${p.id}`}>{p.owner_name}</a>
			),
		},
		{
			key: 'type',
			label: t('common.type'),
			sortable: true,
			getValue: (p: FloorplanDrawingListJson): string =>
				p.location_type === null
					? tp('entity.site', 1)
					: locationTypeLabel(p.location_type),
		},
		{
			key: 'site',
			label: tp('entity.site', 1),
			sortable: true,
			getValue: (p: FloorplanDrawingListJson): string => p.site_name,
		},
		{
			key: 'tenant',
			label: tp('entity.tenant', 1),
			sortable: true,
			getValue: (p: FloorplanDrawingListJson): JSX.Element => (
				<Show when={p.tenant_id !== null} fallback="—">
					<a href={`/tenants/${p.tenant_id}`}>{p.tenant_name}</a>
				</Show>
			),
		},
		{
			key: 'walls',
			label: t('drawnPlan.walls'),
			getValue: (p: FloorplanDrawingListJson): string => String(p.walls),
		},
		{
			key: 'markers',
			label: t('floorplan.markers'),
			getValue: (p: FloorplanDrawingListJson): string => String(p.placements),
		},
	]
	const [visibleColumns, setVisibleColumns] = useTableColumns(
		'floorplans-v2',
		columns.map((c) => c.key),
	)

	const emptyText = (): string =>
		emptyListText({
			noun: tp('noun.drawnFloorplan', 2),
			search: search(),
			filtered: tenantContext().kind !== 'all',
			empty: t('drawnPlan.listEmpty'),
		})

	return (
		<div>
			<div class="page-header">
				<h2>{tp('entity.drawnFloorplan', 2)}</h2>
			</div>

			<FilterTable
				rows={plans.rows}
				filters={filters.filters()}
				filterValues={filters.filterValues}
				onFilterValuesChange={filters.onFilterValuesChange}
				savedFiltersKey="floorplans-v2"
				savedLayoutsKey="floorplans-v2"
				manualFiltering
				quickSearchLabel={t('list.searchLabel', { noun: tp('noun.drawnFloorplan', 2) })}
				getRowId={(p: FloorplanDrawingListJson): number => p.id}
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
				loadingContent={
					<ListLoading rows={plans.rows()} noun={tp('noun.drawnFloorplan', 2)} />
				}
				emptyContent={<Empty message={emptyText()} />}
			/>

			<InlineError message={error()} />
		</div>
	)
}
