import { Result } from 'better-result'
import type { JSX } from 'solid-js'
import { createEffect, createMemo, createResource, createSignal, For } from 'solid-js'
import { type DeviceRow, type DeviceSort, delete_device, fetch_devices } from '../api_devices'
import { fetch_racks, type RackRow } from '../api_racks'
import { fetch_device_types } from '../api_templates'
import { fetch_tenants, type TenantRow } from '../api_tenancy'
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

	const { selected, setSelected, selection } = useListSelection(listSource, 'noun.device')
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
	function rackNameOf(id: number | null): string | null {
		if (id === null) {
			return null
		}
		return racks()?.find((r) => r.id === id)?.name ?? String(id)
	}

	function typeNameOf(id: number): string {
		return types()?.find((type) => type.id === id)?.model ?? String(id)
	}

	const columns: DataTableColumn<DeviceRow>[] = [
		{
			key: 'name',
			label: tp('entity.device', 1),
			sortable: true,
			getValue: (d: DeviceRow): JSX.Element => (
				<a
					href={`/devices/${d.id}`}
					onClick={(e: MouseEvent): void => goTo(e, `/devices/${d.id}`)}
				>
					{d.name}
				</a>
			),
		},
		{
			key: 'type',
			label: t('common.type'),
			getValue: (d: DeviceRow): string => typeNameOf(d.device_type_id),
		},
		{
			key: 'mount',
			label: t('device.mount'),
			getValue: (d: DeviceRow): JSX.Element => (
				<span>
					{d.position_u !== null ? (
						<code>
							{t('device.mountPosition', {
								rack: rackNameOf(d.rack_id) ?? tp('noun.rack', 1),
								u: d.position_u,
							})}
						</code>
					) : (
						<span>{t('device.unracked')}</span>
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
		noun: 'noun.device',
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
			<ListPageHeader title={tp('entity.device', 2)} add_href="/devices/add" />

			<div class="toolbar-row">
				<ListSearchField
					label={t('list.searchLabel', { noun: tp('noun.device', 2) })}
					placeholder={t('device.searchPlaceholder')}
					value={search()}
					onInput={setSearch}
				/>
				<label>
					<span class="visually-hidden">{t('device.filterByRack')}</span>
					<select
						aria-label={t('device.filterByRack')}
						value={rackFilter()}
						onChange={(e: Event & { currentTarget: HTMLSelectElement }): void => {
							setRackFilter(e.currentTarget.value)
						}}
					>
						<option value="">{t('device.allRacks')}</option>
						<For each={racks() ?? []}>
							{(r: RackRow): JSX.Element => <option value={r.id}>{r.name}</option>}
						</For>
					</select>
				</label>
				<label>
					<span class="visually-hidden">{t('common.filterByTenant')}</span>
					<select
						aria-label={t('common.filterByTenant')}
						value={tenantFilter()}
						onChange={(e: Event & { currentTarget: HTMLSelectElement }): void => {
							setTenantFilter(e.currentTarget.value)
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
						name={d.name}
						menu_open={openMenu()?.id === d.id}
						onToggleMenu={(
							e: MouseEvent & { currentTarget: HTMLButtonElement },
						): void => toggleMenu(e, d.id, d.name)}
						onCloseMenu={closeMenu}
					/>
				)}
				loading={() => devicesPage.loading}
				loadingContent={
					<p class="skeleton">{t('list.loading', { noun: tp('noun.device', 2) })}</p>
				}
				emptyContent={
					<p class="empty">
						{hasFilters()
							? t('list.noMatchFilters', { noun: tp('noun.device', 2) })
							: t('device.empty')}
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
