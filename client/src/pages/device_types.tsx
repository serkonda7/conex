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
import { goTo, navigate, parseId, queryParam } from '../router'

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

	const { selected, setSelected, selection } = useListSelection(listSource, 'noun.deviceType')
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
			label: tp('entity.manufacturer', 1),
			getValue: (dt: DeviceTypeRow): string => mfrNameOf(dt.manufacturer_id),
		},
		{
			key: 'model',
			label: t('common.model'),
			sortable: true,
			getValue: (dt: DeviceTypeRow): JSX.Element => (
				<a
					href={`/device-types/${dt.id}`}
					onClick={(e: MouseEvent): void => goTo(e, `/device-types/${dt.id}`)}
				>
					{dt.model}
				</a>
			),
		},
		{
			key: 'description',
			label: t('common.description'),
			getValue: (dt: DeviceTypeRow): string => dt.description ?? '—',
		},
		{
			key: 'comments',
			label: t('common.comments'),
			getValue: (dt: DeviceTypeRow): string => dt.comments ?? '—',
		},
		{
			key: 'u_height',
			label: t('common.heightU'),
			getValue: (dt: DeviceTypeRow): string => `${dt.u_height}`,
		},
		{
			key: 'is_full_depth',
			label: t('common.fullDepth'),
			getValue: (dt: DeviceTypeRow): string =>
				dt.is_full_depth ? t('common.yes') : t('common.no'),
		},
	]

	const [visibleColumns, setVisibleColumns] = useTableColumns(
		'device-types',
		columns.map((c) => c.key),
	)

	const { handleDelete, handleBulkDelete } = useListDelete({
		noun: 'noun.deviceType',
		remove: delete_device_type,
		setError,
		refetch,
		selected,
		setSelected,
	})

	return (
		<div>
			<ListPageHeader
				title={tp('entity.deviceType', 2)}
				add_href="/device-types/add"
				actions={
					<button
						type="button"
						class="btn-add"
						onClick={() => navigate('/device-types/import')}
					>
						{t('deviceType.import')}
					</button>
				}
			/>

			<div class="toolbar-row">
				<ListSearchField
					label={t('list.searchLabel', { noun: tp('noun.deviceType', 2) })}
					placeholder={t('deviceType.searchPlaceholder')}
					value={search()}
					onInput={setSearch}
				/>
				<label>
					<span class="visually-hidden">{t('deviceType.filterByManufacturer')}</span>
					<select
						aria-label={t('deviceType.filterByManufacturer')}
						value={manufacturerFilter()}
						onChange={(e: Event & { currentTarget: HTMLSelectElement }): void => {
							setManufacturerFilter(e.currentTarget.value)
						}}
					>
						<option value="">{t('deviceType.allManufacturers')}</option>
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
				getRowId={(dt: DeviceTypeRow): number => dt.id}
				columns={columns}
				sortKey={sort}
				sortDirection={order}
				onSort={handleSort}
				onSortClear={clearSort}
				showColumnCustomizer
				visibleColumns={visibleColumns}
				onVisibleColumnsChange={setVisibleColumns}
				{...selection}
				rowActions={(dt: DeviceTypeRow): JSX.Element => (
					<ListRowActions
						edit_href={`/device-types/${dt.id}/edit`}
						name={dt.model}
						menu_open={openMenu()?.id === dt.id}
						onToggleMenu={(
							e: MouseEvent & { currentTarget: HTMLButtonElement },
						): void => toggleMenu(e, dt.id, dt.model)}
						onCloseMenu={closeMenu}
					/>
				)}
				loading={() => typesPage.loading}
				loadingContent={
					<p class="skeleton">{t('list.loading', { noun: tp('noun.deviceType', 2) })}</p>
				}
				emptyContent={
					<p class="empty">
						{debouncedSearch() || manufacturerFilter()
							? t('list.noMatchFilters', { noun: tp('noun.deviceType', 2) })
							: t('deviceType.empty')}
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
