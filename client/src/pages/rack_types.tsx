import { DataTable, type DataTableColumn } from '@serkonda7/solid-components'
import { Result } from 'better-result'
import type { JSX } from 'solid-js'
import { createEffect, createMemo, createResource, createSignal, For } from 'solid-js'
import {
	type DeviceTypeRow,
	type DeviceTypeSort,
	delete_device_type,
	fetch_device_types,
	fetch_manufacturers,
	type ManufacturerRow,
} from '../api_templates'
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
import { parseId, queryParam } from '../router'

/**
 * /rack-types — rack-type catalog: search, sortable columns, manufacturer
 * filter (deep-linkable via `?manufacturer=<id>`), row selection with bulk
 * delete, and delete in a row menu. Creating lives on the dedicated
 * /rack-types/add page. The whole result set renders at once (API cap: 200).
 */
export function RackTypesPage(): JSX.Element {
	const [error, setError] = createSignal<string | null>(null)
	const { search, setSearch, debouncedSearch } = useDebouncedSearch()
	const { sort, order, handleSort, clearSort } = useSort<DeviceTypeSort>('model')
	const [manufacturerFilter, setManufacturerFilter] = createSignal(queryParam('manufacturer'))

	// Follow manufacturer links (`/rack-types?manufacturer=<id>`).
	createEffect((): void => {
		setManufacturerFilter(queryParam('manufacturer'))
	})

	const listSource = createMemo(() => ({
		search: debouncedSearch(),
		manufacturer: parseId(manufacturerFilter()) ?? undefined,
		kind: 'rack' as const,
		sort: sort() ?? 'model',
		order: order(),
	}))

	const { selected, setSelected, selection } = useListSelection(
		listSource,
		'Select all rack types',
	)
	const { openMenu, closeMenu, toggleMenu } = useRowMenu()

	const [typesPage, { refetch }] = createResource(listSource, async (s) => {
		const res = await fetch_device_types(s)
		if (Result.isError(res)) {
			setError(res.error.message)
			return null
		}
		return res.value
	})

	const rows = createMemo(() => typesPage()?.items ?? [])
	const total = createMemo(() => typesPage()?.total ?? 0)

	const [manufacturers] = createResource(async () => {
		const res = await fetch_manufacturers({})
		if (Result.isError(res)) {
			setError(res.error.message)
			return []
		}
		return res.value.items
	})

	function mfrNameOf(id: number): string {
		return manufacturers()?.find((m) => m.id === id)?.name ?? String(id)
	}

	const columns: DataTableColumn<DeviceTypeRow>[] = [
		{
			key: 'model',
			label: 'Model',
			sortable: true,
			getValue: (t: DeviceTypeRow): string => t.model,
		},
		{
			key: 'manufacturer',
			label: 'Manufacturer',
			getValue: (t: DeviceTypeRow): string => mfrNameOf(t.manufacturer_id),
		},
		{
			key: 'form_factor',
			label: 'Form factor',
			getValue: (t: DeviceTypeRow): string => t.form_factor ?? '—',
		},
		{
			key: 'width',
			label: 'Width',
			getValue: (t: DeviceTypeRow): string => (t.width === null ? '—' : `${t.width}″`),
		},
		{
			key: 'u_height',
			label: 'U height',
			getValue: (t: DeviceTypeRow): string => `${t.u_height}`,
		},
	]

	const [visibleColumns, setVisibleColumns] = useTableColumns(
		'rack-types',
		columns.map((c) => c.key),
	)

	const { handleDelete, handleBulkDelete } = useListDelete({
		noun: 'rack type',
		remove: delete_device_type,
		setError,
		refetch,
		selected,
		setSelected,
	})

	return (
		<div>
			<ListPageHeader title="Rack types" add_href="/rack-types/add" />

			<div class="toolbar-row">
				<ListSearchField
					label="Search rack types"
					placeholder="Search model…"
					value={search()}
					onInput={setSearch}
				/>
				<label>
					<span class="visually-hidden">Filter by manufacturer</span>
					<select
						aria-label="Filter by manufacturer"
						value={manufacturerFilter()}
						onChange={(e: Event & { currentTarget: HTMLSelectElement }): void => {
							setManufacturerFilter(e.currentTarget.value)
						}}
					>
						<option value="">Any manufacturer</option>
						<For each={manufacturers() ?? []}>
							{(m: ManufacturerRow): JSX.Element => (
								<option value={m.id}>{m.name}</option>
							)}
						</For>
					</select>
				</label>
				<span class="toolbar-spacer" />
				<BulkDeleteButton count={selected().length} onClick={handleBulkDelete} />
			</div>

			<DataTable
				rows={rows}
				getRowId={(t: DeviceTypeRow): number => t.id}
				columns={columns}
				sortKey={sort}
				sortDirection={order}
				onSort={handleSort}
				onSortClear={clearSort}
				showColumnCustomizer
				visibleColumns={visibleColumns}
				onVisibleColumnsChange={setVisibleColumns}
				{...selection}
				rowActions={(t: DeviceTypeRow): JSX.Element => (
					<ListRowActions
						edit_title={`Edit ${t.model}`}
						edit_label={`Edit rack type ${t.model}`}
						menu_label={`More actions for ${t.model}`}
						menu_open={openMenu()?.id === t.id}
						onToggleMenu={(
							e: MouseEvent & { currentTarget: HTMLButtonElement },
						): void => toggleMenu(e, t.id, t.model)}
						onCloseMenu={closeMenu}
					/>
				)}
				loading={() => typesPage.loading}
				loadingContent={<p class="skeleton">Loading rack types…</p>}
				emptyContent={
					<p class="empty">
						{debouncedSearch() || manufacturerFilter()
							? 'No rack types match the current filters.'
							: 'No rack types yet. Add the first one above.'}
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
