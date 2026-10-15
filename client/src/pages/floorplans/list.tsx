import { Result } from 'better-result'
import { createResource, createSignal, type JSX, Show } from 'solid-js'
import { type FloorplanListJson, fetch_floorplans } from '../../api/attachments'
import { type DataTableColumn, FilterTable } from '../../components/data_table'
import { Empty, InlineError, Loading } from '../../components/feedback'
import { ListRangeStatus, useDebouncedSearch, useListFilters } from '../../components/list_page'
import { t, tp } from '../../i18n'
import { locationTypeLabel } from '../../i18n/labels'
import { tenantContext, tenantContextFilters } from '../../lib/tenant_context'

/**
 * /floorplans — overview of every site and location with a marked floor
 * plan, narrowed by the tenant context and searchable by owner or site
 * name. Each row links to the plan's page, where it is viewed and edited.
 */
export function FloorplansPage(): JSX.Element {
	const [error, setError] = createSignal<string | null>(null)
	const { search, setSearch, debouncedSearch } = useDebouncedSearch()
	const filters = useListFilters<FloorplanListJson>({ search, setSearch })

	const [plans] = createResource(
		() => ({ search: debouncedSearch(), context: tenantContextFilters() }),
		async (q) => {
			setError(null)
			const res = await fetch_floorplans({ search: q.search, ...q.context })
			if (Result.isError(res)) {
				setError(res.error.message)
				return null
			}
			return res.value
		},
	)

	const columns: DataTableColumn<FloorplanListJson>[] = [
		{
			key: 'owner',
			label: tp('entity.floorplan', 1),
			getValue: (p: FloorplanListJson): JSX.Element => (
				<a href={`/floorplans/${p.attachment_id}`}>{p.owner_name}</a>
			),
		},
		{
			key: 'type',
			label: t('location.type'),
			getValue: (p: FloorplanListJson): string =>
				p.location_type === null
					? tp('entity.site', 1)
					: locationTypeLabel(p.location_type),
		},
		{
			key: 'site',
			label: tp('entity.site', 1),
			getValue: (p: FloorplanListJson): string => p.site_name,
		},
		{
			key: 'tenant',
			label: tp('entity.tenant', 1),
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

	const emptyText = (): string =>
		debouncedSearch()
			? t('list.noMatch', { noun: tp('noun.floorplan', 2), search: debouncedSearch() })
			: tenantContext().kind !== 'all'
				? t('list.noMatchFilters', { noun: tp('noun.floorplan', 2) })
				: t('floorplan.listEmpty')

	return (
		<div>
			<div class="page-header">
				<h2>{tp('entity.floorplan', 2)}</h2>
			</div>

			<FilterTable
				rows={() => plans() ?? []}
				filters={filters.filters()}
				filterValues={filters.filterValues}
				onFilterValuesChange={filters.onFilterValuesChange}
				manualFiltering
				quickSearchLabel={t('list.searchLabel', { noun: tp('noun.floorplan', 2) })}
				getRowId={(p: FloorplanListJson): number => p.attachment_id}
				columns={columns}
				loading={() => plans.loading}
				loadingContent={
					<Loading message={t('list.loading', { noun: tp('noun.floorplan', 2) })} />
				}
				emptyContent={<Empty message={emptyText()} />}
			/>

			<ListRangeStatus shown={plans()?.length ?? 0} total={plans()?.length ?? 0} />

			<InlineError message={error()} />
		</div>
	)
}
