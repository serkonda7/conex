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
import { navigate, parseId, queryParam } from '../router'

/**
 * /device-types — device-type list: search, sortable columns, manufacturer
 * filter (deep-linkable via `?manufacturer=<id>`), row selection with bulk
 * delete, and icon actions with delete in a row menu. New types can be added
 * manually or imported from the /device-types/import page.
 * The whole result set renders at once (API cap: 200).
 */
export function DeviceTypesPage(): JSX.Element {
	const [error, setError] = createSignal<string | null>(null)
	const { search, setSearch, debouncedSearch } = useDebouncedSearch()
	const { sort, order, handleSort, clearSort } = useSort<DeviceTypeSort>('model')
	const [manufacturerFilter, setManufacturerFilter] = createSignal(queryParam('manufacturer'))

	// Follow manufacturer links (`/device-types?manufacturer=<id>`).
	createEffect((): void => {
		setManufacturerFilter(queryParam('manufacturer'))
	})

	const listSource = createMemo(() => ({
		search: debouncedSearch(),
		manufacturer: parseId(manufacturerFilter()) ?? undefined,
		sort: sort() ?? 'model',
		order: order(),
	}))

	const { selected, setSelected, selection } = useListSelection(
		listSource,
		'Select all device types',
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
			key: 'manufacturer',
			label: 'Hersteller',
			getValue: (t: DeviceTypeRow): string => mfrNameOf(t.manufacturer_id),
		},
		{
			key: 'model',
			label: 'Modell',
			sortable: true,
			getValue: (t: DeviceTypeRow): JSX.Element => (
				<a
					href={`/device-types/${t.id}`}
					onClick={(e: MouseEvent): void => go(e, `/device-types/${t.id}`)}
				>
					{t.model}
				</a>
			),
		},
		{
			key: 'description',
			label: 'Beschreibung',
			getValue: (t: DeviceTypeRow): string => t.description ?? '—',
		},
		{
			key: 'comments',
			label: 'Kommentare',
			getValue: (t: DeviceTypeRow): string => t.comments ?? '—',
		},
		{
			key: 'u_height',
			label: 'Höhe (HE)',
			getValue: (t: DeviceTypeRow): string => `${t.u_height}`,
		},
		{
			key: 'is_full_depth',
			label: 'Volle Tiefe',
			getValue: (t: DeviceTypeRow): string => (t.is_full_depth ? 'Yes' : 'No'),
		},
	]

	const [visibleColumns, setVisibleColumns] = useTableColumns(
		'device-types',
		columns.map((c) => c.key),
	)

	const { handleDelete, handleBulkDelete } = useListDelete({
		noun: 'device type',
		remove: delete_device_type,
		setError,
		refetch,
		selected,
		setSelected,
	})

	return (
		<div>
			<ListPageHeader
				title="Device types"
				add_href="/device-types/add"
				actions={
					<button
						type="button"
						class="btn-add"
						onClick={() => navigate('/device-types/import')}
					>
						⭳ Import
					</button>
				}
			/>

			<div class="toolbar-row">
				<ListSearchField
					label="Gerätetypen suchen"
					placeholder="Modell suchen…"
					value={search()}
					onInput={setSearch}
				/>
				<label>
					<span class="visually-hidden">Filter by manufacturer</span>
					<select
						aria-label="Nach Hersteller filtern"
						value={manufacturerFilter()}
						onChange={(e: Event & { currentTarget: HTMLSelectElement }): void => {
							setManufacturerFilter(e.currentTarget.value)
						}}
					>
						<option value="">Alle Hersteller</option>
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
						edit_href={`/device-types/${t.id}/edit`}
						edit_title={`Edit ${t.model}`}
						edit_label={`Edit device type ${t.model}`}
						menu_label={`More actions for ${t.model}`}
						menu_open={openMenu()?.id === t.id}
						onToggleMenu={(
							e: MouseEvent & { currentTarget: HTMLButtonElement },
						): void => toggleMenu(e, t.id, t.model)}
						onCloseMenu={closeMenu}
					/>
				)}
				loading={() => typesPage.loading}
				loadingContent={<p class="skeleton">Gerätetypen werden geladen…</p>}
				emptyContent={
					<p class="empty">
						{debouncedSearch() || manufacturerFilter()
							? 'Keine Gerätetypen für die aktuellen Filter gefunden.'
							: 'Noch keine Gerätetypen vorhanden. Importieren Sie oben den ersten Datensatz.'}
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
