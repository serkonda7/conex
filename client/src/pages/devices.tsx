import { DataTable, type DataTableColumn } from '@serkonda7/solid-components'
import { Result } from 'better-result'
import type { JSX } from 'solid-js'
import { createEffect, createMemo, createResource, createSignal, For } from 'solid-js'
import { type DeviceRow, type DeviceSort, delete_device, fetch_devices } from '../api_devices'
import { fetch_racks, type RackRow } from '../api_racks'
import { fetch_device_types } from '../api_templates'
import { fetch_tenants, type TenantRow } from '../api_tenancy'
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
 * /devices — NetBox-style device list: search, sortable columns, rack / tenant
 * filters (tenant deep-linkable via `?tenant=<id>`), row
 * selection with bulk delete, and icon actions with delete in a row menu.
 * Creating lives on the dedicated /devices/add page, editing on
 * /devices/:id/edit. The whole result set renders at once (API cap: 200).
 */
export function DevicesPage(): JSX.Element {
	const [error, setError] = createSignal<string | null>(null)
	const { search, setSearch, debouncedSearch } = useDebouncedSearch()
	const { sort, order, handleSort, clearSort } = useSort<DeviceSort>('name')
	const [rackFilter, setRackFilter] = createSignal('')
	const [tenantFilter, setTenantFilter] = createSignal(queryParam('tenant'))

	// Follow tenant links from the tenants table (`/devices?tenant=<id>`).
	createEffect((): void => {
		setTenantFilter(queryParam('tenant'))
	})

	const listSource = createMemo(() => ({
		search: debouncedSearch(),
		sort: sort() ?? 'name',
		order: order(),
		rack: parseId(rackFilter()) ?? undefined,
		tenant: parseId(tenantFilter()) ?? undefined,
	}))

	const { selected, setSelected, selection } = useListSelection(listSource, 'Select all devices')
	const { openMenu, closeMenu, toggleMenu } = useRowMenu()

	const [devicesPage, { refetch }] = createResource(listSource, async (s) => {
		const res = await fetch_devices(s)
		if (Result.isError(res)) {
			setError(res.error.message)
			return null
		}
		return res.value
	})

	const rows = createMemo(() => devicesPage()?.items ?? [])
	const total = createMemo(() => devicesPage()?.total ?? 0)

	const [types] = createResource(async () => {
		const res = await fetch_device_types()
		if (Result.isError(res)) {
			setError(res.error.message)
			return []
		}
		return res.value.items
	})
	const [racks] = createResource(async () => {
		const res = await fetch_racks()
		if (Result.isError(res)) {
			setError(res.error.message)
			return []
		}
		return res.value.items
	})
	const [tenants] = createResource(async () => {
		const res = await fetch_tenants()
		if (Result.isError(res)) {
			setError(res.error.message)
			return []
		}
		return res.value.items
	})

	function typeNameOf(id: number): string {
		return types()?.find((t) => t.id === id)?.model ?? String(id)
	}

	function rackNameOf(id: number | null): string | null {
		if (id === null) {
			return null
		}
		return racks()?.find((r) => r.id === id)?.name ?? String(id)
	}

	const columns: DataTableColumn<DeviceRow>[] = [
		{
			key: 'name',
			label: 'Device',
			sortable: true,
			getValue: (d: DeviceRow): JSX.Element => (
				<a
					href={`/devices/${d.id}`}
					onClick={(e: MouseEvent): void => go(e, `/devices/${d.id}`)}
				>
					{d.name}
				</a>
			),
		},
		{
			key: 'type',
			label: 'Type',
			getValue: (d: DeviceRow): string => typeNameOf(d.device_type_id),
		},
		{
			key: 'mount',
			label: 'Mount',
			getValue: (d: DeviceRow): JSX.Element => (
				<span>
					{d.position_u !== null ? (
						<code>
							{rackNameOf(d.rack_id) ?? 'rack'} HE{d.position_u}
						</code>
					) : (
						<span>unracked</span>
					)}
				</span>
			),
		},
	]

	const [visibleColumns, setVisibleColumns] = useTableColumns(
		'devices',
		columns.map((c) => c.key),
	)

	const { handleDelete, handleBulkDelete } = useListDelete({
		noun: 'device',
		remove: delete_device,
		setError,
		refetch,
		selected,
		setSelected,
	})

	const hasFilters = createMemo(
		() => debouncedSearch() !== '' || rackFilter() !== '' || tenantFilter() !== '',
	)

	return (
		<div>
			<ListPageHeader title="Geräte" add_href="/devices/add" />

			<div class="toolbar-row">
				<ListSearchField
					label="Geräte suchen"
					placeholder="Name oder Seriennummer suchen…"
					value={search()}
					onInput={setSearch}
				/>
				<label>
					<span class="visually-hidden">Filter by rack</span>
					<select
						aria-label="Filter by rack"
						value={rackFilter()}
						onChange={(e: Event & { currentTarget: HTMLSelectElement }): void => {
							setRackFilter(e.currentTarget.value)
						}}
					>
						<option value="">Alle Racks</option>
						<For each={racks() ?? []}>
							{(r: RackRow): JSX.Element => <option value={r.id}>{r.name}</option>}
						</For>
					</select>
				</label>
				<label>
					<span class="visually-hidden">Filter by tenant</span>
					<select
						aria-label="Filter by tenant"
						value={tenantFilter()}
						onChange={(e: Event & { currentTarget: HTMLSelectElement }): void => {
							setTenantFilter(e.currentTarget.value)
						}}
					>
						<option value="">Alle Mandanten</option>
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
				getRowId={(d: DeviceRow): number => d.id}
				columns={columns}
				sortKey={sort}
				sortDirection={order}
				onSort={handleSort}
				onSortClear={clearSort}
				showColumnCustomizer
				visibleColumns={visibleColumns}
				onVisibleColumnsChange={setVisibleColumns}
				{...selection}
				rowActions={(d: DeviceRow): JSX.Element => (
					<ListRowActions
						edit_href={`/devices/${d.id}/edit`}
						edit_title={`Edit ${d.name}`}
						edit_label={`Edit device ${d.name}`}
						menu_label={`More actions for ${d.name}`}
						menu_open={openMenu()?.id === d.id}
						onToggleMenu={(
							e: MouseEvent & { currentTarget: HTMLButtonElement },
						): void => toggleMenu(e, d.id, d.name)}
						onCloseMenu={closeMenu}
					/>
				)}
				loading={() => devicesPage.loading}
				loadingContent={<p class="skeleton">Geräte werden geladen…</p>}
				emptyContent={
					<p class="empty">
						{hasFilters()
							? 'Keine Geräte für die aktuellen Filter gefunden.'
							: 'Noch keine Geräte vorhanden. Fügen Sie oben das erste hinzu.'}
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
