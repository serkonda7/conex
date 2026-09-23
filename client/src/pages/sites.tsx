import { DataTable, type DataTableColumn } from '@serkonda7/solid-components'
import { Result } from 'better-result'
import type { JSX } from 'solid-js'
import { createEffect, createMemo, createResource, createSignal, For } from 'solid-js'
import {
	delete_site,
	fetch_site_groups,
	fetch_sites,
	fetch_tenants,
	type SiteGroupRow,
	type SiteRow,
	type SiteSort,
	type SiteWithExtras,
	type TenantRow,
} from '../api_tenancy'
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
import { parseId, queryParam } from '../router'

/**
 * /sites — NetBox-style site list: search, sortable columns, tenant
 * filter (deep-linkable via `?tenant=<id>`), row selection with bulk
 * delete, and icon actions with delete in a row menu. Editing lives on
 * the dedicated /sites/:id/edit page. The whole result set renders at
 * once (API cap: 200).
 */
export function SitesPage(): JSX.Element {
	const [error, setError] = createSignal<string | null>(null)
	const { search, setSearch, debouncedSearch } = useDebouncedSearch()
	const { sort, order, handleSort, clearSort } = useSort<SiteSort>('name')
	const [filterTenant, setFilterTenant] = createSignal(queryParam('tenant'))

	// Follow tenant links from the tenant detail page (`/sites?tenant=<id>`).
	createEffect((): void => {
		setFilterTenant(queryParam('tenant'))
	})

	const [tenants] = createResource(async () => {
		const res = await fetch_tenants()
		if (Result.isError(res)) {
			setError(res.error.message)
			return []
		}
		return res.value.items
	})

	const [groups] = createResource(async () => {
		const res = await fetch_site_groups()
		if (Result.isError(res)) {
			// The site-groups backend may lag this frontend change; a failed
			// group lookup degrades to '—' cells rather than an error.
			return []
		}
		return res.value.items
	})

	const listSource = createMemo(() => ({
		search: debouncedSearch(),
		sort: sort() ?? 'name',
		order: order(),
		tenant: parseId(filterTenant()) ?? undefined,
	}))

	const { selected, setSelected, selection } = useListSelection(listSource, 'Select all sites')
	const { openMenu, closeMenu, toggleMenu } = useRowMenu()

	const [sitesPage, { refetch }] = createResource(listSource, async (s) => {
		const res = await fetch_sites(s)
		if (Result.isError(res)) {
			setError(res.error.message)
			return null
		}
		return res.value
	})

	const rows = createMemo(() => sitesPage()?.items ?? [])
	const total = createMemo(() => sitesPage()?.total ?? 0)

	function tenantNameOf(id: number | null): string {
		if (!id) {
			return '—'
		}
		return tenants()?.find((t) => t.id === id)?.name ?? String(id)
	}

	function groupNameOf(row: SiteRow): string {
		const id = (row as SiteWithExtras).site_group_id ?? null
		if (!id) {
			return '—'
		}
		return groups()?.find((g: SiteGroupRow) => g.id === id)?.name ?? String(id)
	}

	const columns: DataTableColumn<SiteRow>[] = [
		{
			key: 'name',
			label: 'Site',
			sortable: true,
			getValue: (s: SiteRow): JSX.Element => (
				<a
					href={`/sites/${s.id}`}
					onClick={(e: MouseEvent): void => go(e, `/sites/${s.id}`)}
				>
					{s.name}
				</a>
			),
		},
		{
			key: 'description',
			label: 'Description',
			sortable: true,
			class: 'cell-truncate',
			getValue: (s: SiteRow): JSX.Element => (
				<span title={s.description ?? ''}>{s.description || '—'}</span>
			),
		},
		{
			key: 'tenant',
			label: 'Tenant',
			getValue: (s: SiteRow): string => tenantNameOf(s.tenant_id),
		},
		{
			key: 'group',
			label: 'Group',
			getValue: (s: SiteRow): string => groupNameOf(s),
		},
	]

	const [visibleColumns, setVisibleColumns] = useTableColumns(
		'sites',
		columns.map((c) => c.key),
	)

	const { handleDelete, handleBulkDelete } = useListDelete({
		noun: 'site',
		remove: delete_site,
		setError,
		refetch,
		selected,
		setSelected,
	})

	return (
		<div>
			<ListPageHeader title="Sites" add_href="/sites/add" />

			<div class="toolbar-row">
				<ListSearchField
					label="Search sites"
					placeholder="Search name, slug…"
					value={search()}
					onInput={setSearch}
				/>
				<label>
					<span class="visually-hidden">Filter by tenant</span>
					<select
						aria-label="Filter by tenant"
						value={filterTenant()}
						onChange={(e: Event & { currentTarget: HTMLSelectElement }): void => {
							setFilterTenant(e.currentTarget.value)
						}}
					>
						<option value="">All tenants</option>
						<For each={tenants() ?? []}>
							{(t: TenantRow): JSX.Element => <option value={t.id}>{t.name}</option>}
						</For>
					</select>
				</label>
				<span class="toolbar-spacer" />
				<BulkDeleteButton count={selected().length} onClick={handleBulkDelete} />
			</div>

			<DataTable
				rows={rows}
				getRowId={(s: SiteRow): number => s.id}
				columns={columns}
				sortKey={sort}
				sortDirection={order}
				onSort={handleSort}
				onSortClear={clearSort}
				showColumnCustomizer
				visibleColumns={visibleColumns}
				onVisibleColumnsChange={setVisibleColumns}
				{...selection}
				rowActions={(s: SiteRow): JSX.Element => (
					<ListRowActions
						edit_href={`/sites/${s.id}/edit`}
						edit_title={`Edit ${s.name}`}
						edit_label={`Edit site ${s.name}`}
						menu_label={`More actions for ${s.name}`}
						menu_open={openMenu()?.id === s.id}
						onToggleMenu={(
							e: MouseEvent & { currentTarget: HTMLButtonElement },
						): void => toggleMenu(e, s.id, s.name)}
						onCloseMenu={closeMenu}
					/>
				)}
				loading={() => sitesPage.loading}
				loadingContent={<p class="skeleton">Loading sites…</p>}
				emptyContent={
					<p class="empty">
						{debouncedSearch() || filterTenant()
							? 'No sites match the current filters.'
							: 'No sites yet. Add the first one above.'}
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
