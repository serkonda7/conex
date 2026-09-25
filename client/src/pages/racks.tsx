import { Result } from 'better-result'
import type { JSX } from 'solid-js'
import { createEffect, createMemo, createResource, createSignal, For } from 'solid-js'
import { delete_rack, fetch_racks, type RackRow, type RackSort } from '../api_racks'
import { type DeviceTypeRow, fetch_device_types } from '../api_templates'
import {
	fetch_locations,
	fetch_sites,
	fetch_tenants,
	type LocationRow,
	type SiteRow,
	type TenantRow,
} from '../api_tenancy'
import { DataTable, type DataTableColumn } from '../components/data_table'
import {
	BulkDeleteButton,
	go,
	ListError,
	ListPageHeader,
	ListRangeStatus,
	ListRowActions,
	ListSearchField,
	RowMenu,
	type RowMenuAnchor,
	useDebouncedSearch,
	useListDelete,
	useListSelection,
	useRowMenu,
	useSort,
	useTableColumns,
} from '../components/list_page'
import { t, tp } from '../i18n'
import { parseId, queryParam } from '../router'

/**
 * /racks — NetBox-style rack list: search, sortable columns, site /
 * location / tenant filters (deep-linkable via `?site=<id>` /
 * `?location=<id>` / `?tenant=<id>`), row selection with bulk delete, and
 * icon actions with delete in a row menu. Creating lives on the dedicated
 * /racks/add page, editing on /racks/:id/edit. The whole result set
 * renders at once (API cap: 200).
 */
export function RacksPage(): JSX.Element {
	const [error, setError] = createSignal<string | null>(null)
	const { search, setSearch, debouncedSearch } = useDebouncedSearch()
	const { sort, order, handleSort, clearSort } = useSort<RackSort>('name')
	const [filterSite, setFilterSite] = createSignal(queryParam('site'))
	const [filterLocation, setFilterLocation] = createSignal(queryParam('location'))
	const [filterTenant, setFilterTenant] = createSignal(queryParam('tenant'))

	// Follow site/location/tenant links from detail pages.
	createEffect(() => {
		setFilterSite(queryParam('site'))
		setFilterLocation(queryParam('location'))
		setFilterTenant(queryParam('tenant'))
	})

	const [sites] = createResource(async () => {
		const res = await fetch_sites()
		if (Result.isError(res)) {
			setError(res.error.message)
			return []
		}
		return res.value.items
	})

	const [tenants] = createResource(async () => {
		const res = await fetch_tenants()
		if (Result.isError(res)) {
			setError(res.error.message)
			return []
		}
		return res.value.items
	})

	// Location filter options follow the site filter; the table resolves
	// location names from the same list.
	const [locations] = createResource(filterSite, async (site: string) => {
		const siteId = parseId(site)
		const res = await fetch_locations(siteId ? { site: siteId } : undefined)
		if (Result.isError(res)) {
			setError(res.error.message)
			return []
		}
		return res.value.items
	})

	const listSource = createMemo(() => ({
		search: debouncedSearch(),
		site: parseId(filterSite()) ?? undefined,
		location: parseId(filterLocation()) ?? undefined,
		tenant: parseId(filterTenant()) ?? undefined,
		sort: sort() ?? 'name',
		order: order(),
	}))

	const { selected, setSelected, selection } = useListSelection(listSource, 'noun.rack')
	const { openMenu, closeMenu, toggleMenu } = useRowMenu()

	const [racksPage, { refetch }] = createResource(listSource, async (s) => {
		const res = await fetch_racks(s)
		if (Result.isError(res)) {
			setError(res.error.message)
			return null
		}
		return res.value
	})

	const rows = createMemo(() => racksPage()?.items ?? [])
	const [rackTypes] = createResource(async () => {
		const result = await fetch_device_types({ kind: 'rack' })
		return Result.isOk(result) ? result.value.items : []
	})
	const total = createMemo(() => racksPage()?.total ?? 0)

	// Changing the site resets a location that belongs to another site.
	function handleSiteFilter(value: string): void {
		setFilterSite(value)
		setFilterLocation('')
	}

	function siteNameOf(siteId: number): string {
		return sites()?.find((s: SiteRow) => s.id === siteId)?.name ?? String(siteId)
	}

	function locationNameOf(id: number | null): string {
		if (!id) {
			return '—'
		}
		return locations()?.find((l: LocationRow) => l.id === id)?.name ?? String(id)
	}

	function tenantNameOf(id: number | null): string {
		if (!id) {
			return '—'
		}
		return tenants()?.find((row: TenantRow) => row.id === id)?.name ?? String(id)
	}

	function rackTypeNameOf(id: number | null): string {
		if (!id) {
			return '—'
		}
		return rackTypes()?.find((type: DeviceTypeRow) => type.id === id)?.model ?? String(id)
	}

	const columns: DataTableColumn<RackRow>[] = [
		{
			key: 'name',
			label: tp('entity.rack', 1),
			sortable: true,
			getValue: (r: RackRow): JSX.Element => (
				<a
					href={`/racks/${r.id}`}
					onClick={(e: MouseEvent): void => go(e, `/racks/${r.id}`)}
				>
					{r.name}
				</a>
			),
		},
		{
			key: 'site',
			label: tp('entity.site', 1),
			getValue: (r: RackRow): string => siteNameOf(r.site_id),
		},
		{
			key: 'location',
			label: tp('entity.location', 1),
			getValue: (r: RackRow): string => locationNameOf(r.location_id),
		},
		{
			key: 'description',
			label: t('common.description'),
			class: 'cell-truncate',
			getValue: (r: RackRow): JSX.Element => (
				<span title={r.description ?? ''}>{r.description || '—'}</span>
			),
		},
		{
			key: 'type',
			label: t('common.type'),
			getValue: (r: RackRow): string => rackTypeNameOf(r.rack_type_id),
		},
		{
			key: 'tenant',
			label: tp('entity.tenant', 1),
			getValue: (r: RackRow): string => tenantNameOf(r.tenant_id),
		},
	]

	const [visibleColumns, setVisibleColumns] = useTableColumns(
		'racks',
		columns.map((c) => c.key),
	)

	const { handleDelete, handleBulkDelete } = useListDelete({
		noun: 'noun.rack',
		remove: delete_rack,
		setError,
		refetch,
		selected,
		setSelected,
	})

	return (
		<div>
			<ListPageHeader title={tp('entity.rack', 2)} add_href="/racks/add" />

			<div class="toolbar-row">
				<ListSearchField
					label={t('list.searchLabel', { noun: tp('noun.rack', 2) })}
					placeholder={t('manufacturer.searchPlaceholder')}
					value={search()}
					onInput={setSearch}
				/>
				<label>
					<span class="visually-hidden">{t('location.filterBySite')}</span>
					<select
						aria-label={t('location.filterBySite')}
						value={filterSite()}
						onChange={(e: Event & { currentTarget: HTMLSelectElement }) =>
							handleSiteFilter(e.currentTarget.value)
						}
					>
						<option value="">{t('location.allSites')}</option>
						<For each={sites() ?? []}>
							{(s: SiteRow): JSX.Element => <option value={s.id}>{s.name}</option>}
						</For>
					</select>
				</label>
				<label>
					<span class="visually-hidden">{t('rack.filterByLocation')}</span>
					<select
						aria-label={t('rack.filterByLocation')}
						value={filterLocation()}
						onChange={(e: Event & { currentTarget: HTMLSelectElement }) =>
							setFilterLocation(e.currentTarget.value)
						}
					>
						<option value="">{t('rack.allLocations')}</option>
						<For each={locations() ?? []}>
							{(l: LocationRow): JSX.Element => (
								<option value={l.id}>{l.name}</option>
							)}
						</For>
					</select>
				</label>
				<label>
					<span class="visually-hidden">{t('common.filterByTenant')}</span>
					<select
						aria-label={t('common.filterByTenant')}
						value={filterTenant()}
						onChange={(e: Event & { currentTarget: HTMLSelectElement }) =>
							setFilterTenant(e.currentTarget.value)
						}
					>
						<option value="">{t('common.allTenants')}</option>
						<For each={tenants() ?? []}>
							{(row: TenantRow): JSX.Element => (
								<option value={row.id}>{row.name}</option>
							)}
						</For>
					</select>
				</label>
				<span class="toolbar-spacer" />
				<BulkDeleteButton count={selected().length} onClick={handleBulkDelete} />
			</div>

			<DataTable
				rows={rows}
				getRowId={(r: RackRow): number => r.id}
				columns={columns}
				sortKey={sort}
				sortDirection={order}
				onSort={handleSort}
				onSortClear={clearSort}
				showColumnCustomizer
				visibleColumns={visibleColumns}
				onVisibleColumnsChange={setVisibleColumns}
				{...selection}
				rowActions={(r: RackRow): JSX.Element => (
					<ListRowActions
						edit_href={`/racks/${r.id}/edit`}
						name={r.name}
						menu_open={openMenu()?.id === r.id}
						onToggleMenu={(
							e: MouseEvent & { currentTarget: HTMLButtonElement },
						): void => toggleMenu(e, r.id, r.name)}
						onCloseMenu={closeMenu}
					/>
				)}
				loading={() => racksPage.loading}
				loadingContent={
					<p class="skeleton">{t('list.loading', { noun: tp('noun.rack', 2) })}</p>
				}
				emptyContent={
					<p class="empty">
						{debouncedSearch() || filterSite() || filterLocation() || filterTenant()
							? t('list.noMatchFilters', { noun: tp('noun.rack', 2) })
							: t('rack.empty')}
					</p>
				}
			/>

			<ListRangeStatus total={total()} />

			<RowMenu
				menu={openMenu}
				onClose={closeMenu}
				onDelete={(menu: RowMenuAnchor): void => {
					void handleDelete(menu.id, menu.name)
				}}
			/>

			<ListError message={error()} />
		</div>
	)
}
