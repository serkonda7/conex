import { Result } from 'better-result'
import type { JSX } from 'solid-js'
import { createEffect, createMemo, createResource, createSignal, For } from 'solid-js'
import {
	delete_site_group,
	fetch_site_groups,
	fetch_tenants,
	type SiteGroupRow,
	type SiteGroupSort,
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
 * /site-groups — NetBox-style site group list: search, sortable columns,
 * parent column, row selection with bulk delete, and icon actions with
 * delete in a row menu. Editing lives on the dedicated
 * /site-groups/:id/edit page. The whole result set renders at once
 * (API cap: 200).
 */
export function SiteGroupsPage(): JSX.Element {
	const [error, setError] = createSignal<string | null>(null)
	const { search, setSearch, debouncedSearch } = useDebouncedSearch()
	const { sort, order, handleSort, clearSort } = useSort<SiteGroupSort>('name')
	const [filterTenant, setFilterTenant] = createSignal(queryParam('tenant'))

	// Follow tenant links from the tenant detail page (`/site-groups?tenant=<id>`).
	createEffect(() => {
		setFilterTenant(queryParam('tenant'))
	})

	const listSource = createMemo(() => ({
		search: debouncedSearch(),
		sort: sort() ?? 'name',
		order: order(),
		tenant: parseId(filterTenant()) ?? undefined,
	}))

	const { selected, setSelected, selection } = useListSelection(listSource, 'noun.siteGroup')
	const { openMenu, closeMenu, toggleMenu } = useRowMenu()

	const [groupsPage, { refetch }] = createResource(listSource, async (s) => {
		const res = await fetch_site_groups(s)
		if (Result.isError(res)) {
			setError(res.error.message)
			return null
		}
		return res.value
	})

	const rows = createMemo(() => groupsPage()?.items ?? [])
	const total = createMemo(() => groupsPage()?.total ?? 0)

	const [tenants] = createResource(async () => {
		const res = await fetch_tenants()
		if (Result.isError(res)) {
			setError(res.error.message)
			return []
		}
		return res.value.items
	})

	function tenantNameOf(id: number | null): string {
		if (!id) {
			return '—'
		}
		return tenants()?.find((row: TenantRow) => row.id === id)?.name ?? String(id)
	}

	// Id → name map for the Parent column, resolved from the same result set.
	const parentNameOf = createMemo(() => {
		const byId = new Map<number, string>()
		for (const g of rows()) {
			byId.set(g.id, g.name)
		}
		return (id: number | null): string => {
			if (id === null || id === undefined) {
				return '—'
			}
			return byId.get(id) ?? String(id)
		}
	})

	const columns: DataTableColumn<SiteGroupRow>[] = [
		{
			key: 'name',
			label: t('common.group'),
			sortable: true,
			getValue: (g: SiteGroupRow): JSX.Element => (
				<a
					href={`/site-groups/${g.id}`}
					onClick={(e: MouseEvent): void => goTo(e, `/site-groups/${g.id}`)}
				>
					{g.name}
				</a>
			),
		},
		{
			key: 'description',
			label: t('common.description'),
			sortable: true,
			class: 'cell-truncate',
			getValue: (g: SiteGroupRow): JSX.Element => (
				<span title={g.description ?? ''}>{g.description || '—'}</span>
			),
		},
		{
			key: 'parent',
			label: t('siteGroup.parent'),
			getValue: (g: SiteGroupRow): string => parentNameOf()(g.parent_id),
		},
		{
			key: 'tenant',
			label: tp('entity.tenant', 1),
			getValue: (g: SiteGroupRow): string => tenantNameOf(g.tenant_id),
		},
	]

	const group_column_keys = columns.map((c) => c.key)
	const [visibleColumns, setVisibleColumns] = useTableColumns('site-groups', group_column_keys)

	const { handleDelete, handleBulkDelete } = useListDelete({
		noun: 'noun.siteGroup',
		remove: delete_site_group,
		setError,
		refetch,
		selected,
		setSelected,
	})

	return (
		<div>
			<ListPageHeader title={tp('entity.siteGroup', 2)} add_href="/site-groups/add" />

			<div class="toolbar-row">
				<ListSearchField
					label={t('list.searchLabel', { noun: tp('noun.siteGroup', 2) })}
					placeholder={t('tenant.searchPlaceholder')}
					value={search()}
					onInput={setSearch}
				/>
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
				getRowId={(g: SiteGroupRow): number => g.id}
				columns={columns}
				sortKey={sort}
				sortDirection={order}
				onSort={handleSort}
				onSortClear={clearSort}
				showColumnCustomizer
				visibleColumns={visibleColumns}
				onVisibleColumnsChange={setVisibleColumns}
				{...selection}
				rowActions={(g: SiteGroupRow): JSX.Element => (
					<ListRowActions
						edit_href={`/site-groups/${g.id}/edit`}
						name={g.name}
						menu_open={openMenu()?.id === g.id}
						onToggleMenu={(
							e: MouseEvent & { currentTarget: HTMLButtonElement },
						): void => toggleMenu(e, g.id, g.name)}
						onCloseMenu={closeMenu}
					/>
				)}
				loading={() => groupsPage.loading}
				loadingContent={
					<p class="skeleton">{t('list.loading', { noun: tp('noun.siteGroup', 2) })}</p>
				}
				emptyContent={
					<p class="empty">
						{debouncedSearch() || filterTenant()
							? t('list.noMatchFilters', { noun: tp('noun.siteGroup', 2) })
							: t('siteGroup.empty')}
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
