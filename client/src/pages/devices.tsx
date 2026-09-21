import { DataTable, type DataTableColumn } from '@serkonda7/solid-components'
import { IconDotsVertical, IconPencil, IconTrash } from '@tabler/icons-solidjs'
import { Result } from 'better-result'
import type { InputEventAndTarget } from 'shared/src/types'
import type { JSX } from 'solid-js'
import {
	createEffect,
	createMemo,
	createResource,
	createSignal,
	For,
	onCleanup,
	onMount,
	Show,
} from 'solid-js'
import { Portal } from 'solid-js/web'
import { fetch_tenants, type TenantRow } from '../api_p1'
import { fetch_racks, type RackRow } from '../api_p2'
import { fetch_device_types } from '../api_p3'
import { type DeviceRow, type DeviceSort, delete_device, fetch_devices } from '../api_p4'
import { navigate, parseId, queryParam } from '../router'
import { use_visible_columns } from '../util/column_visibility'

function go(e: MouseEvent, to: string): void {
	e.preventDefault()
	navigate(to)
}

/**
 * /devices — NetBox-style device list: search, sortable columns, status /
 * rack / tenant filters (tenant deep-linkable via `?tenant=<id>`), row
 * selection with bulk delete, and icon actions with delete in a row menu.
 * Creating lives on the dedicated /devices/add page, editing on
 * /devices/:id/edit. The whole result set renders at once (API cap: 200).
 */
export function DevicesPage(): JSX.Element {
	const [error, setError] = createSignal<string | null>(null)
	const [search, setSearch] = createSignal('')
	const [debouncedSearch, setDebouncedSearch] = createSignal('')
	const [sort, setSort] = createSignal<DeviceSort | undefined>('name')
	const [order, setOrder] = createSignal<'asc' | 'desc'>('asc')
	const [status, setStatus] = createSignal('')
	const [rackFilter, setRackFilter] = createSignal('')
	const [tenantFilter, setTenantFilter] = createSignal(queryParam('tenant'))
	const [selected, setSelected] = createSignal<number[]>([])
	/**
	 * Anchor for the row menu, rendered in a Portal so the table's scroll
	 * container can never clip it. `edge` is a viewport `top` offset when
	 * opening downward, a `bottom` offset when flipped upward.
	 */
	interface RowMenuAnchor {
		id: number
		name: string
		edge: number
		right: number
		up: boolean
	}
	const [openMenu, setOpenMenu] = createSignal<RowMenuAnchor | null>(null)

	// Follow tenant links from the tenants table (`/devices?tenant=<id>`).
	createEffect(() => {
		setTenantFilter(queryParam('tenant'))
	})

	let debounceTimer: number | undefined
	onMount(() => {
		// Dismiss an open row menu on outside click (same pattern as the
		// account menu in App.tsx). The menu is viewport-anchored, so any
		// scroll or resize dismisses it too instead of leaving it adrift.
		const onDocClick = (e: MouseEvent): void => {
			if (!(e.target instanceof Element)) {
				return
			}
			if (e.target.closest('.row-menu-wrap') === null) {
				setOpenMenu(null)
			}
		}
		document.addEventListener('click', onDocClick)
		window.addEventListener('scroll', closeMenu, true)
		window.addEventListener('resize', closeMenu)
		onCleanup(() => {
			document.removeEventListener('click', onDocClick)
			window.removeEventListener('scroll', closeMenu, true)
			window.removeEventListener('resize', closeMenu)
		})
	})
	createEffect(() => {
		const q = search()
		window.clearTimeout(debounceTimer)
		debounceTimer = window.setTimeout(() => {
			setDebouncedSearch(q.trim())
		}, 250)
	})
	onCleanup(() => {
		window.clearTimeout(debounceTimer)
	})

	const listSource = createMemo(() => ({
		search: debouncedSearch(),
		sort: sort() ?? 'name',
		order: order(),
		status: (status() || undefined) as
			| 'active'
			| 'planned'
			| 'staged'
			| 'decommissioned'
			| undefined,
		rack: parseId(rackFilter()) ?? undefined,
		tenant: parseId(tenantFilter()) ?? undefined,
	}))

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
	const rangeStart = createMemo(() => (total() === 0 ? 0 : 1))
	const rangeEnd = createMemo(() => total())

	// A new result set invalidates the checkbox selection.
	createEffect(() => {
		listSource()
		setSelected([])
	})

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

	function handleSort(key: string): void {
		const col = key as DeviceSort
		if (sort() === col) {
			setOrder(order() === 'asc' ? 'desc' : 'asc')
		} else {
			setSort(col)
			setOrder('asc')
		}
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
			key: 'status',
			label: 'Status',
			sortable: true,
			getValue: (d: DeviceRow): JSX.Element => (
				<span class={`badge badge-${d.status}`}>{d.status}</span>
			),
		},
		{
			key: 'mount',
			label: 'Mount',
			getValue: (d: DeviceRow): JSX.Element => (
				<span>
					{d.shelf_id ? (
						<code>shelf:{d.shelf_id}</code>
					) : d.position_u !== null ? (
						<code>
							{rackNameOf(d.rack_id) ?? 'rack'} U{d.position_u}
						</code>
					) : (
						<span>unracked</span>
					)}
				</span>
			),
		},
		{
			key: 'asset_tag',
			label: 'Asset tag',
			getValue: (d: DeviceRow): string => d.asset_tag ?? '—',
		},
	]

	const device_column_keys = columns.map((c) => c.key)
	const [visibleColumns, setVisibleColumns] = use_visible_columns('devices', device_column_keys)

	function closeMenu(): void {
		setOpenMenu(null)
	}

	/**
	 * Anchors the row menu to the toggle button in viewport coordinates.
	 * Flips upward when there is no room below (e.g. the last table row).
	 */
	function toggleMenu(
		e: MouseEvent & { currentTarget: HTMLButtonElement },
		id: number,
		name: string,
	): void {
		if (openMenu()?.id === id) {
			setOpenMenu(null)
			return
		}
		const rect = e.currentTarget.getBoundingClientRect()
		const gap = 4
		// Single-item menu height estimate; the upward anchor uses `bottom`
		// so only this flip decision depends on it.
		const menuHeight = 64
		const spaceBelow = window.innerHeight - rect.bottom - gap
		const spaceAbove = rect.top - gap
		const up = spaceBelow < menuHeight && spaceAbove >= menuHeight
		setOpenMenu({
			id,
			name,
			edge: up ? window.innerHeight - rect.top + gap : rect.bottom + gap,
			right: Math.max(0, window.innerWidth - rect.right),
			up,
		})
	}

	async function handleDelete(id: number, name: string): Promise<void> {
		if (!window.confirm(`Delete device "${name}"?`)) {
			return
		}
		setError(null)
		const res = await delete_device(id)
		if (Result.isError(res)) {
			setError(res.error.message)
			return
		}
		setSelected((prev) => prev.filter((s) => s !== id))
		void refetch()
	}

	async function handleBulkDelete(): Promise<void> {
		const ids = selected()
		if (ids.length === 0) {
			return
		}
		if (!window.confirm(`Delete ${ids.length} device${ids.length === 1 ? '' : 's'}?`)) {
			return
		}
		setError(null)
		const failures: string[] = []
		for (const id of ids) {
			const res = await delete_device(id)
			if (Result.isError(res)) {
				failures.push(res.error.message)
			}
		}
		setSelected([])
		if (failures.length > 0) {
			setError(failures[0] ?? 'Bulk delete failed')
		}
		void refetch()
	}

	const hasFilters = createMemo(
		() =>
			debouncedSearch() !== '' ||
			status() !== '' ||
			rackFilter() !== '' ||
			tenantFilter() !== '',
	)

	return (
		<div>
			<div class="page-header">
				<h2>Devices</h2>
				<button type="button" class="btn-add" onClick={() => navigate('/devices/add')}>
					+ Add
				</button>
			</div>

			<div class="toolbar-row">
				<label class="toolbar-search">
					<span class="visually-hidden">Search devices</span>
					<input
						type="search"
						class="toolbar-search-input"
						placeholder="Search name, asset tag, serial…"
						aria-label="Search devices"
						value={search()}
						onInput={(e: InputEventAndTarget) => setSearch(e.currentTarget.value)}
					/>
				</label>
				<label>
					<span class="visually-hidden">Filter by status</span>
					<select
						aria-label="Filter by status"
						value={status()}
						onChange={(e: Event & { currentTarget: HTMLSelectElement }) =>
							setStatus(e.currentTarget.value)
						}
					>
						<option value="">Any status</option>
						<option value="active">active</option>
						<option value="planned">planned</option>
						<option value="staged">staged</option>
						<option value="decommissioned">decommissioned</option>
					</select>
				</label>
				<label>
					<span class="visually-hidden">Filter by rack</span>
					<select
						aria-label="Filter by rack"
						value={rackFilter()}
						onChange={(e: Event & { currentTarget: HTMLSelectElement }) =>
							setRackFilter(e.currentTarget.value)
						}
					>
						<option value="">Any rack</option>
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
						onChange={(e: Event & { currentTarget: HTMLSelectElement }) =>
							setTenantFilter(e.currentTarget.value)
						}
					>
						<option value="">Any tenant</option>
						<For each={tenants() ?? []}>
							{(t: TenantRow): JSX.Element => <option value={t.id}>{t.name}</option>}
						</For>
					</select>
				</label>
				<span class="toolbar-spacer" />
				<Show when={selected().length > 0}>
					<button type="button" class="btn-danger" onClick={handleBulkDelete}>
						Delete {selected().length} selected
					</button>
				</Show>
			</div>

			<DataTable
				rows={rows}
				getRowId={(d: DeviceRow): number => d.id}
				columns={columns}
				sortKey={sort}
				sortDirection={order}
				onSort={handleSort}
				onSortClear={() => {
					setSort(undefined)
					setOrder('asc')
				}}
				showColumnCustomizer
				visibleColumns={visibleColumns}
				onVisibleColumnsChange={setVisibleColumns}
				selected={selected}
				onSelectionChange={(ids: (string | number)[]): void => {
					setSelected(ids.map((id) => Number(id)))
				}}
				selectionLabel="Select all devices"
				rowActions={(d: DeviceRow): JSX.Element => (
					<div class="row-actions">
						<button
							type="button"
							class="icon-btn"
							title={`Edit ${d.name}`}
							aria-label={`Edit device ${d.name}`}
							onClick={() => navigate(`/devices/${d.id}/edit`)}
						>
							<IconPencil size={16} />
						</button>
						<div class="row-menu-wrap">
							<button
								type="button"
								class="icon-btn"
								aria-label={`More actions for ${d.name}`}
								aria-haspopup="menu"
								aria-expanded={openMenu()?.id === d.id}
								onClick={(
									e: MouseEvent & {
										currentTarget: HTMLButtonElement
									},
								): void => toggleMenu(e, d.id, d.name)}
								onKeyDown={(e: KeyboardEvent): void => {
									if (e.key === 'Escape') {
										setOpenMenu(null)
									}
								}}
							>
								<IconDotsVertical size={16} />
							</button>
						</div>
					</div>
				)}
				loading={() => devicesPage.loading}
				loadingContent={<p class="skeleton">Loading devices…</p>}
				emptyContent={
					<p class="empty">
						{hasFilters()
							? 'No devices match the current filters.'
							: 'No devices yet. Add the first one above.'}
					</p>
				}
			/>

			<p class="paginator-showing" role="status">
				Showing {rangeStart()}-{rangeEnd()} of {total()}
			</p>

			<Show when={openMenu() !== null}>
				<Portal>
					<div
						class="row-menu"
						role="menu"
						aria-label={`Actions for ${openMenu()?.name ?? ''}`}
						style={{
							top: openMenu()?.up ? undefined : `${openMenu()?.edge ?? 0}px`,
							bottom: openMenu()?.up ? `${openMenu()?.edge ?? 0}px` : undefined,
							right: `${openMenu()?.right ?? 0}px`,
						}}
					>
						<button
							type="button"
							role="menuitem"
							class="row-menu-danger"
							onClick={() => {
								const menu = openMenu()
								setOpenMenu(null)
								if (menu) {
									void handleDelete(menu.id, menu.name)
								}
							}}
							onKeyDown={(e: KeyboardEvent): void => {
								if (e.key === 'Escape') {
									setOpenMenu(null)
								}
							}}
						>
							<IconTrash size={16} />
							Delete
						</button>
					</div>
				</Portal>
			</Show>

			<Show when={error()}>
				<div class="app-inline-error">{error()}</div>
			</Show>
		</div>
	)
}
