import { DataTable, type DataTableColumn } from '@serkonda7/solid-components'
import { Result } from 'better-result'
import type { JSX } from 'solid-js'
import { createMemo, createResource, createSignal } from 'solid-js'
import {
	delete_manufacturer,
	fetch_manufacturers,
	type ManufacturerRow,
	type ManufacturerSort,
} from '../api_templates'
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

	const { selected, setSelected, selection } = useListSelection(
		listSource,
		'Select all manufacturers',
	)
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
			label: 'Name',
			sortable: true,
			getValue: (m: ManufacturerRow): JSX.Element => (
				<a
					href={`/manufacturers/${m.id}`}
					onClick={(e: MouseEvent): void => go(e, `/manufacturers/${m.id}`)}
				>
					{m.name}
				</a>
			),
		},
		{
			key: 'description',
			label: 'Beschreibung',
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
		noun: 'manufacturer',
		remove: delete_manufacturer,
		setError,
		refetch,
		selected,
		setSelected,
	})

	return (
		<div>
			<ListPageHeader title="Hersteller" add_href="/manufacturers/add" />

			<div class="toolbar-row">
				<ListSearchField
					label="Hersteller suchen"
					placeholder="Namen suchen…"
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
						edit_title={`Edit ${m.name}`}
						edit_label={`Edit manufacturer ${m.name}`}
						menu_label={`More actions for ${m.name}`}
						menu_open={openMenu()?.id === m.id}
						onToggleMenu={(
							e: MouseEvent & { currentTarget: HTMLButtonElement },
						): void => toggleMenu(e, m.id, m.name)}
						onCloseMenu={closeMenu}
					/>
				)}
				loading={() => manufacturersPage.loading}
				loadingContent={<p class="skeleton">Hersteller werden geladen…</p>}
				emptyContent={
					<p class="empty">
						{debouncedSearch()
							? `Keine Hersteller für „${debouncedSearch()}“ gefunden.`
							: 'Noch keine Hersteller vorhanden. Fügen Sie oben den ersten hinzu.'}
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
