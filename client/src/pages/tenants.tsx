import { DataTable, type DataTableColumn } from '@serkonda7/solid-components'
import { Result } from 'better-result'
import type { JSX } from 'solid-js'
import { createMemo, createResource, createSignal } from 'solid-js'
import {
	delete_tenant,
	fetch_tenants,
	type TenantSort,
	type TenantWithCounts,
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

/**
 * /tenants — NetBox-style tenant list: search, sortable columns, row
 * selection with bulk delete, and icon actions with delete in a row menu.
 * Editing lives on the dedicated /tenants/:id/edit page. The whole result
 * set renders at once (API cap: 200).
 */
export function TenantsPage(): JSX.Element {
	const [error, setError] = createSignal<string | null>(null)
	const { search, setSearch, debouncedSearch } = useDebouncedSearch()
	const { sort, order, handleSort, clearSort } = useSort<TenantSort>('name')

	const listSource = createMemo(() => ({
		search: debouncedSearch(),
		sort: sort() ?? 'name',
		order: order(),
	}))

	const { selected, setSelected, selection } = useListSelection(listSource, 'Select all tenants')
	const { openMenu, closeMenu, toggleMenu } = useRowMenu()

	const [tenantsPage, { refetch }] = createResource(listSource, async (s) => {
		const res = await fetch_tenants(s)
		if (Result.isError(res)) {
			setError(res.error.message)
			return null
		}
		return res.value
	})

	const rows = createMemo(() => tenantsPage()?.items ?? [])
	const total = createMemo(() => tenantsPage()?.total ?? 0)

	const columns: DataTableColumn<TenantWithCounts>[] = [
		{
			key: 'name',
			label: 'Tenant',
			sortable: true,
			getValue: (t: TenantWithCounts): JSX.Element => (
				<a
					href={`/tenants/${t.id}`}
					onClick={(e: MouseEvent): void => go(e, `/tenants/${t.id}`)}
				>
					{t.name}
				</a>
			),
		},
		{
			key: 'description',
			label: 'Description',
			sortable: true,
			class: 'cell-truncate',
			getValue: (t: TenantWithCounts): JSX.Element => (
				<span title={t.description ?? ''}>{t.description || '—'}</span>
			),
		},
	]

	const [visibleColumns, setVisibleColumns] = useTableColumns(
		'tenants',
		columns.map((c) => c.key),
	)

	const { handleDelete, handleBulkDelete } = useListDelete({
		noun: 'tenant',
		remove: delete_tenant,
		setError,
		refetch,
		selected,
		setSelected,
	})

	return (
		<div>
			<ListPageHeader title="Tenants" add_href="/tenants/add" />

			<div class="toolbar-row">
				<ListSearchField
					label="Search tenants"
					placeholder="Search name, slug, description…"
					value={search()}
					onInput={setSearch}
				/>
				<span class="toolbar-spacer" />
				<BulkDeleteButton count={selected().length} onClick={handleBulkDelete} />
			</div>

			<DataTable
				rows={rows}
				getRowId={(t: TenantWithCounts): number => t.id}
				columns={columns}
				sortKey={sort}
				sortDirection={order}
				onSort={handleSort}
				onSortClear={clearSort}
				showColumnCustomizer
				visibleColumns={visibleColumns}
				onVisibleColumnsChange={setVisibleColumns}
				{...selection}
				rowActions={(t: TenantWithCounts): JSX.Element => (
					<ListRowActions
						edit_href={`/tenants/${t.id}/edit`}
						edit_title={`Edit ${t.name}`}
						edit_label={`Edit tenant ${t.name}`}
						menu_label={`More actions for ${t.name}`}
						menu_open={openMenu()?.id === t.id}
						onToggleMenu={(
							e: MouseEvent & { currentTarget: HTMLButtonElement },
						): void => toggleMenu(e, t.id, t.name)}
						onCloseMenu={closeMenu}
					/>
				)}
				loading={() => tenantsPage.loading}
				loadingContent={<p class="skeleton">Loading tenants…</p>}
				emptyContent={
					<p class="empty">
						{debouncedSearch()
							? `No tenants match "${debouncedSearch()}".`
							: 'No tenants yet. Add the first one above.'}
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
