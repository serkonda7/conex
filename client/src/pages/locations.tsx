import { Result } from 'better-result'
import type { JSX } from 'solid-js'
import { createEffect, createMemo, createResource, createSignal, For } from 'solid-js'
import {
	delete_location,
	fetch_locations,
	fetch_sites,
	fetch_tenants,
	type LocationRow,
	type LocationSort,
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
 * /locations — NetBox-style location list: search, sortable columns, site +
 * tenant filters (deep-linkable via `?site=<id>` / `?tenant=<id>`), row
 * selection with bulk delete, and icon actions with delete in a row menu.
 * Editing lives on the dedicated /locations/:id/edit page. The whole
 * result set renders at once (API cap: 200).
 */
export function LocationsPage(): JSX.Element {
	const [error, setError] = createSignal<string | null>(null)
	const { search, setSearch, debouncedSearch } = useDebouncedSearch()
	const { sort, order, handleSort, clearSort } = useSort<LocationSort>('name')
	const [filterSite, setFilterSite] = createSignal(queryParam('site'))
	const [filterTenant, setFilterTenant] = createSignal(queryParam('tenant'))

	// Follow site/tenant links from detail pages (`/locations?site=<id>`).
	createEffect(() => {
		setFilterSite(queryParam('site'))
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

	const listSource = createMemo(() => ({
		search: debouncedSearch(),
		site: parseId(filterSite()) ?? undefined,
		tenant: parseId(filterTenant()) ?? undefined,
		sort: sort() ?? 'name',
		order: order(),
	}))

	const { selected, setSelected, selection } = useListSelection(listSource, 'noun.location')
	const { openMenu, closeMenu, toggleMenu } = useRowMenu()

	const [locationsPage, { refetch }] = createResource(listSource, async (s) => {
		const res = await fetch_locations(s)
		if (Result.isError(res)) {
			setError(res.error.message)
			return null
		}
		return res.value
	})

	const rows = createMemo(() => locationsPage()?.items ?? [])
	const total = createMemo(() => locationsPage()?.total ?? 0)

	function siteNameOf(siteId: number): string {
		return sites()?.find((s: SiteRow) => s.id === siteId)?.name ?? String(siteId)
	}

	// Keep the parent value available when the optional Parent column is
	// enabled through the column customizer.
	const parentNameOf = createMemo(() => {
		const byId = new Map<number, string>()
		for (const l of rows()) {
			byId.set(l.id, l.name)
		}
		return (id: number | null): string =>
			id === null || id === undefined ? '—' : (byId.get(id) ?? String(id))
	})

	// Derive the nesting level from the parent links so the table can show the
	// hierarchy without spending a column on the parent name. The visited set
	// also keeps a malformed response from causing an infinite loop.
	const locationDepthOf = createMemo(() => {
		const parentOf = new Map<number, number | null>()
		for (const l of rows()) {
			parentOf.set(l.id, l.parent_id)
		}
		return (location: LocationRow): number => {
			let depth = 0
			let parent = location.parent_id
			const visited = new Set<number>([location.id])
			while (parent !== null && parentOf.has(parent) && !visited.has(parent)) {
				visited.add(parent)
				depth += 1
				parent = parentOf.get(parent) ?? null
			}
			return depth
		}
	})

	function tenantNameOf(id: number | null): string {
		if (!id) {
			return '—'
		}
		return tenants()?.find((row: TenantRow) => row.id === id)?.name ?? String(id)
	}

	const columns: DataTableColumn<LocationRow>[] = [
		{
			key: 'name',
			label: tp('entity.location', 1),
			sortable: true,
			getValue: (l: LocationRow): JSX.Element => (
				<div
					class={`location-tree-name${locationDepthOf()(l) > 0 ? ' location-tree-child' : ''}`}
					style={{ '--location-depth': locationDepthOf()(l) }}
				>
					<a
						href={`/locations/${l.id}`}
						onClick={(e: MouseEvent): void => go(e, `/locations/${l.id}`)}
					>
						{l.name}
					</a>
				</div>
			),
		},
		{
			key: 'site',
			label: tp('entity.site', 1),
			getValue: (l: LocationRow): string => siteNameOf(l.site_id),
		},
		{
			key: 'parent',
			label: t('site.parentLocation'),
			getValue: (l: LocationRow): string => parentNameOf()(l.parent_id),
		},
		{
			key: 'tenant',
			label: tp('entity.tenant', 1),
			getValue: (l: LocationRow): string => tenantNameOf(l.tenant_id),
		},
	]

	const [visibleColumns, setVisibleColumns] = useTableColumns(
		'locations',
		columns.map((c) => c.key),
		['name', 'site', 'tenant'],
	)

	const { handleDelete, handleBulkDelete } = useListDelete({
		noun: 'noun.location',
		remove: delete_location,
		setError,
		refetch,
		selected,
		setSelected,
	})

	return (
		<div>
			<ListPageHeader title={tp('entity.location', 2)} add_href="/locations/add" />

			<div class="toolbar-row">
				<ListSearchField
					label={t('list.searchLabel', { noun: tp('noun.location', 2) })}
					placeholder={t('site.searchPlaceholder')}
					value={search()}
					onInput={setSearch}
				/>
				<label>
					<span class="visually-hidden">{t('location.filterBySite')}</span>
					<select
						aria-label={t('location.filterBySite')}
						value={filterSite()}
						onChange={(e: Event & { currentTarget: HTMLSelectElement }) =>
							setFilterSite(e.currentTarget.value)
						}
					>
						<option value="">{t('location.allSites')}</option>
						<For each={sites() ?? []}>
							{(s: SiteRow): JSX.Element => <option value={s.id}>{s.name}</option>}
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
				getRowId={(l: LocationRow): number => l.id}
				columns={columns}
				sortKey={sort}
				sortDirection={order}
				onSort={handleSort}
				onSortClear={clearSort}
				showColumnCustomizer
				visibleColumns={visibleColumns}
				onVisibleColumnsChange={setVisibleColumns}
				{...selection}
				rowActions={(l: LocationRow): JSX.Element => (
					<ListRowActions
						edit_href={`/locations/${l.id}/edit`}
						name={l.name}
						menu_open={openMenu()?.id === l.id}
						onToggleMenu={(
							e: MouseEvent & { currentTarget: HTMLButtonElement },
						): void => toggleMenu(e, l.id, l.name)}
						onCloseMenu={closeMenu}
					/>
				)}
				loading={() => locationsPage.loading}
				loadingContent={
					<p class="skeleton">{t('list.loading', { noun: tp('noun.location', 2) })}</p>
				}
				emptyContent={
					<p class="empty">
						{debouncedSearch() || filterSite() || filterTenant()
							? t('list.noMatchFilters', { noun: tp('noun.location', 2) })
							: t('location.empty')}
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
