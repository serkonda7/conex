import { Result } from 'better-result'
import type { JSX } from 'solid-js'
import { createMemo, createResource, createSignal } from 'solid-js'
import {
	delete_tenant,
	fetch_tenants,
	type TenantSort,
	type TenantWithCounts,
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
import { goTo } from '../router'

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

	const { selected, setSelected, selection } = useListSelection(listSource, 'noun.tenant')
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
			label: tp('entity.tenant', 1),
			sortable: true,
			getValue: (row: TenantWithCounts): JSX.Element => (
				<a
					href={`/tenants/${row.id}`}
					onClick={(e: MouseEvent): void => goTo(e, `/tenants/${row.id}`)}
				>
					{row.name}
				</a>
			),
		},
		{
			key: 'description',
			label: t('common.description'),
			sortable: true,
			class: 'cell-truncate',
			getValue: (row: TenantWithCounts): JSX.Element => (
				<span title={row.description ?? ''}>{row.description || '—'}</span>
			),
		},
	]

	const [visibleColumns, setVisibleColumns] = useTableColumns(
		'tenants',
		columns.map((c) => c.key),
	)

	const { handleDelete, handleBulkDelete } = useListDelete({
		noun: 'noun.tenant',
		remove: delete_tenant,
		setError,
		refetch,
		selected,
		setSelected,
	})

	return (
		<div>
			<ListPageHeader title={tp('entity.tenant', 2)} add_href="/tenants/add" />

			<div class="toolbar-row">
				<ListSearchField
					label={t('list.searchLabel', { noun: tp('noun.tenant', 2) })}
					placeholder={t('tenant.searchPlaceholder')}
					value={search()}
					onInput={setSearch}
				/>
				<span class="toolbar-spacer" />
				<BulkDeleteButton count={selected().length} onClick={handleBulkDelete} />
			</div>

			<DataTable
				rows={rows}
				getRowId={(row: TenantWithCounts): number => row.id}
				columns={columns}
				sortKey={sort}
				sortDirection={order}
				onSort={handleSort}
				onSortClear={clearSort}
				showColumnCustomizer
				visibleColumns={visibleColumns}
				onVisibleColumnsChange={setVisibleColumns}
				{...selection}
				rowActions={(row: TenantWithCounts): JSX.Element => (
					<ListRowActions
						edit_href={`/tenants/${row.id}/edit`}
						name={row.name}
						menu_open={openMenu()?.id === row.id}
						onToggleMenu={(
							e: MouseEvent & { currentTarget: HTMLButtonElement },
						): void => toggleMenu(e, row.id, row.name)}
						onCloseMenu={closeMenu}
					/>
				)}
				loading={() => tenantsPage.loading}
				loadingContent={
					<p class="skeleton">{t('list.loading', { noun: tp('noun.tenant', 2) })}</p>
				}
				emptyContent={
					<p class="empty">
						{debouncedSearch()
							? t('list.noMatch', {
									noun: tp('noun.tenant', 2),
									search: debouncedSearch(),
								})
							: t('tenant.empty')}
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
