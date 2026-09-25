import { Result } from 'better-result'
import type { JSX } from 'solid-js'
import { createMemo, createResource, createSignal } from 'solid-js'
import {
	delete_manufacturer,
	fetch_manufacturers,
	type ManufacturerRow,
	type ManufacturerSort,
} from '../api_templates'
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
 * /manufacturers — manufacturer list: search, sortable columns, row
 * selection with bulk delete, and icon actions with delete in a row menu.
 * Editing lives on the dedicated /manufacturers/:id/edit page. The whole
 * result set renders at once (API cap: 200).
 */
export function ManufacturersPage(): JSX.Element {
	const [error, setError] = createSignal<string | null>(null)
	const { search, setSearch, debouncedSearch } = useDebouncedSearch()
	const { sort, order, handleSort, clearSort } = useSort<ManufacturerSort>('name')

	const listSource = createMemo(() => ({
		search: debouncedSearch(),
		sort: sort() ?? 'name',
		order: order(),
	}))

	const { selected, setSelected, selection } = useListSelection(listSource, 'noun.manufacturer')
	const { openMenu, closeMenu, toggleMenu } = useRowMenu()

	const [manufacturersPage, { refetch }] = createResource(listSource, async (s) => {
		const res = await fetch_manufacturers(s)
		if (Result.isError(res)) {
			setError(res.error.message)
			return null
		}
		return res.value
	})

	const rows = createMemo(() => manufacturersPage()?.items ?? [])
	const total = createMemo(() => manufacturersPage()?.total ?? 0)

	const columns: DataTableColumn<ManufacturerRow>[] = [
		{
			key: 'name',
			label: t('common.name'),
			sortable: true,
			getValue: (m: ManufacturerRow): JSX.Element => (
				<a
					href={`/manufacturers/${m.id}`}
					onClick={(e: MouseEvent): void => goTo(e, `/manufacturers/${m.id}`)}
				>
					{m.name}
				</a>
			),
		},
		{
			key: 'description',
			label: t('common.description'),
			sortable: true,
			class: 'cell-truncate',
			getValue: (m: ManufacturerRow): JSX.Element => (
				<span title={m.description ?? ''}>{m.description || '—'}</span>
			),
		},
	]

	const [visibleColumns, setVisibleColumns] = useTableColumns(
		'manufacturers',
		columns.map((c) => c.key),
	)

	const { handleDelete, handleBulkDelete } = useListDelete({
		noun: 'noun.manufacturer',
		remove: delete_manufacturer,
		setError,
		refetch,
		selected,
		setSelected,
	})

	return (
		<div>
			<ListPageHeader title={tp('entity.manufacturer', 2)} add_href="/manufacturers/add" />

			<div class="toolbar-row">
				<ListSearchField
					label={t('list.searchLabel', { noun: tp('noun.manufacturer', 2) })}
					placeholder={t('manufacturer.searchPlaceholder')}
					value={search()}
					onInput={setSearch}
				/>
				<span class="toolbar-spacer" />
				<BulkDeleteButton count={selected().length} onClick={handleBulkDelete} />
			</div>

			<DataTable
				rows={rows}
				getRowId={(m: ManufacturerRow): number => m.id}
				columns={columns}
				sortKey={sort}
				sortDirection={order}
				onSort={handleSort}
				onSortClear={clearSort}
				showColumnCustomizer
				visibleColumns={visibleColumns}
				onVisibleColumnsChange={setVisibleColumns}
				{...selection}
				rowActions={(m: ManufacturerRow): JSX.Element => (
					<ListRowActions
						edit_href={`/manufacturers/${m.id}/edit`}
						name={m.name}
						menu_open={openMenu()?.id === m.id}
						onToggleMenu={(
							e: MouseEvent & { currentTarget: HTMLButtonElement },
						): void => toggleMenu(e, m.id, m.name)}
						onCloseMenu={closeMenu}
					/>
				)}
				loading={() => manufacturersPage.loading}
				loadingContent={
					<p class="skeleton">
						{t('list.loading', { noun: tp('noun.manufacturer', 2) })}
					</p>
				}
				emptyContent={
					<p class="empty">
						{debouncedSearch()
							? t('list.noMatch', {
									noun: tp('noun.manufacturer', 2),
									search: debouncedSearch(),
								})
							: t('manufacturer.empty')}
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
