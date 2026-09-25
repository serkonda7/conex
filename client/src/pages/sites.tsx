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
import { DataTable, type DataTableColumn } from '../components/data_table'
import {
	BulkDeleteButton,
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
import { goTo, parseId, queryParam } from '../router'

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

	const { selected, setSelected, selection } = useListSelection(listSource, 'noun.site')
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
		return tenants()?.find((row) => row.id === id)?.name ?? String(id)
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
			label: tp('entity.site', 1),
			sortable: true,
			getValue: (s: SiteRow): JSX.Element => (
				<a
					href={`/sites/${s.id}`}
					onClick={(e: MouseEvent): void => goTo(e, `/sites/${s.id}`)}
				>
					{s.name}
				</a>
			),
		},
		{
			key: 'description',
			label: t('common.description'),
			sortable: true,
			class: 'cell-truncate',
			getValue: (s: SiteRow): JSX.Element => (
				<span title={s.description ?? ''}>{s.description || '—'}</span>
			),
		},
		{
			key: 'tenant',
			label: tp('entity.tenant', 1),
			getValue: (s: SiteRow): string => tenantNameOf(s.tenant_id),
		},
		{
			key: 'group',
			label: t('common.group'),
			getValue: (s: SiteRow): string => groupNameOf(s),
		},
	]

	const [visibleColumns, setVisibleColumns] = useTableColumns(
		'sites',
		columns.map((c) => c.key),
	)

	const { handleDelete, handleBulkDelete } = useListDelete({
		noun: 'noun.site',
		remove: delete_site,
		setError,
		refetch,
		selected,
		setSelected,
	})

	return (
		<div>
			<ListPageHeader title={tp('entity.site', 2)} add_href="/sites/add" />

			<div class="toolbar-row">
				<ListSearchField
					label={t('list.searchLabel', { noun: tp('noun.site', 2) })}
					placeholder={t('site.searchPlaceholder')}
					value={search()}
					onInput={setSearch}
				/>
				<label>
					<span class="visually-hidden">{t('common.filterByTenant')}</span>
					<select
						aria-label={t('common.filterByTenant')}
						value={filterTenant()}
						onChange={(e: Event & { currentTarget: HTMLSelectElement }): void => {
							setFilterTenant(e.currentTarget.value)
						}}
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
						name={s.name}
						menu_open={openMenu()?.id === s.id}
						onToggleMenu={(
							e: MouseEvent & { currentTarget: HTMLButtonElement },
						): void => toggleMenu(e, s.id, s.name)}
						onCloseMenu={closeMenu}
					/>
				)}
				loading={() => sitesPage.loading}
				loadingContent={
					<p class="skeleton">{t('list.loading', { noun: tp('noun.site', 2) })}</p>
				}
				emptyContent={
					<p class="empty">
						{debouncedSearch() || filterTenant()
							? t('list.noMatchFilters', { noun: tp('noun.site', 2) })
							: t('site.empty')}
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
