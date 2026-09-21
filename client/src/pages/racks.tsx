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
import {
	fetch_locations,
	fetch_sites,
	fetch_tenants,
	type LocationRow,
	type SiteRow,
	type TenantRow,
} from '../api_p1'
import { delete_rack, fetch_racks, type RackRow, type RackSort } from '../api_p2'
import { navigate, parseId, queryParam } from '../router'
import { use_visible_columns } from '../util/column_visibility'

function go(e: MouseEvent, to: string): void {
	e.preventDefault()
	navigate(to)
}

/**
 * /racks — NetBox-style rack list: search, sortable columns, site /
 * location / tenant filters (deep-linkable via `?site=<id>` /
 * `?location=<id>` / `?tenant=<id>`), row selection with bulk delete, and
 * icon actions with delete in a row menu. Creating lives on the dedicated
 * /racks/add page, editing on /racks/:id/edit. The whole result set
 * renders at once (API cap: 200).
 */
export function RacksPage(): JSX.Element {
	const [error, setError] = createSignal<string | null>(null)
	const [search, setSearch] = createSignal('')
	const [debouncedSearch, setDebouncedSearch] = createSignal('')
	const [sort, setSort] = createSignal<RackSort>('name')
	const [order, setOrder] = createSignal<'asc' | 'desc'>('asc')
	const [selected, setSelected] = createSignal<number[]>([])
	const [filterSite, setFilterSite] = createSignal(queryParam('site'))
	const [filterLocation, setFilterLocation] = createSignal(queryParam('location'))
	const [filterTenant, setFilterTenant] = createSignal(queryParam('tenant'))
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

	// Follow site/location/tenant links from detail pages.
	createEffect(() => {
		setFilterSite(queryParam('site'))
		setFilterLocation(queryParam('location'))
		setFilterTenant(queryParam('tenant'))
	})

	let debounceTimer: number | undefined
	onMount(() => {
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

	const [sites] = createResource(async () => {
		const res = await fetch_sites()
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

	// Location filter options follow the site filter; the table resolves
	// location names from the same list.
	const [locations] = createResource(filterSite, async (site: string) => {
		const siteId = parseId(site)
		const res = await fetch_locations(siteId ? { site: siteId } : undefined)
		if (Result.isError(res)) {
			setError(res.error.message)
			return []
		}
		return res.value.items
	})

	const listSource = createMemo(() => ({
		search: debouncedSearch(),
		site: parseId(filterSite()) ?? undefined,
		location: parseId(filterLocation()) ?? undefined,
		tenant: parseId(filterTenant()) ?? undefined,
		sort: sort(),
		order: order(),
	}))

	const [racksPage, { refetch }] = createResource(listSource, async (s) => {
		const res = await fetch_racks(s)
		if (Result.isError(res)) {
			setError(res.error.message)
			return null
		}
		return res.value
	})

	const rows = createMemo(() => racksPage()?.items ?? [])
	const total = createMemo(() => racksPage()?.total ?? 0)
	const rangeStart = createMemo(() => (total() === 0 ? 0 : 1))
	const rangeEnd = createMemo(() => total())

	// A new result set invalidates the checkbox selection.
	createEffect(() => {
		listSource()
		setSelected([])
	})

	// Changing the site resets a location that belongs to another site.
	function handleSiteFilter(value: string): void {
		setFilterSite(value)
		setFilterLocation('')
	}

	function siteNameOf(siteId: number): string {
		return sites()?.find((s: SiteRow) => s.id === siteId)?.name ?? String(siteId)
	}

	function locationNameOf(id: number | null): string {
		if (!id) {
			return '—'
		}
		return locations()?.find((l: LocationRow) => l.id === id)?.name ?? String(id)
	}

	function tenantNameOf(id: number | null): string {
		if (!id) {
			return '—'
		}
		return tenants()?.find((t: TenantRow) => t.id === id)?.name ?? String(id)
	}

	function handleSort(key: string): void {
		const col = key as RackSort
		if (sort() === col) {
			setOrder(order() === 'asc' ? 'desc' : 'asc')
		} else {
			setSort(col)
			setOrder('asc')
		}
	}

	const columns: DataTableColumn<RackRow>[] = [
		{
			key: 'name',
			label: 'Rack',
			sortable: true,
			getValue: (r: RackRow): JSX.Element => (
				<a
					href={`/racks/${r.id}`}
					onClick={(e: MouseEvent): void => go(e, `/racks/${r.id}`)}
				>
					{r.name}
				</a>
			),
		},
		{
			key: 'site',
			label: 'Site',
			getValue: (r: RackRow): string => siteNameOf(r.site_id),
		},
		{
			key: 'location',
			label: 'Location',
			getValue: (r: RackRow): string => locationNameOf(r.location_id),
		},
		{
			key: 'description',
			label: 'Description',
			class: 'cell-truncate',
			getValue: (r: RackRow): JSX.Element => (
				<span title={r.description ?? ''}>{r.description || '—'}</span>
			),
		},
		{
			key: 'status',
			label: 'Status',
			sortable: true,
			getValue: (r: RackRow): JSX.Element => (
				<span class={`badge badge-${r.status}`}>{r.status}</span>
			),
		},
		{
			key: 'type',
			label: 'Type',
			getValue: () => <span title="Rack types coming soon">—</span>,
		},
		{
			key: 'tenant',
			label: 'Tenant',
			getValue: (r: RackRow): string => tenantNameOf(r.tenant_id),
		},
	]

	const rack_column_keys = columns.map((c) => c.key)
	const [visibleColumns, setVisibleColumns] = use_visible_columns('racks', rack_column_keys)

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
		if (!window.confirm(`Delete rack "${name}"?`)) {
			return
		}
		setError(null)
		const res = await delete_rack(id)
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
		if (!window.confirm(`Delete ${ids.length} rack${ids.length === 1 ? '' : 's'}?`)) {
			return
		}
		setError(null)
		const failures: string[] = []
		for (const id of ids) {
			const res = await delete_rack(id)
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

	return (
		<div>
			<div class="page-header">
				<h2>Racks</h2>
				<button type="button" class="btn-add" onClick={() => navigate('/racks/add')}>
					+ Add
				</button>
			</div>

			<div class="toolbar-row">
				<label class="toolbar-search">
					<span class="visually-hidden">Search racks</span>
					<input
						type="search"
						class="toolbar-search-input"
						placeholder="Search name, slug…"
						aria-label="Search racks"
						value={search()}
						onInput={(e: InputEventAndTarget) => setSearch(e.currentTarget.value)}
					/>
				</label>
				<label>
					<span class="visually-hidden">Filter by site</span>
					<select
						aria-label="Filter by site"
						value={filterSite()}
						onChange={(e: Event & { currentTarget: HTMLSelectElement }) =>
							handleSiteFilter(e.currentTarget.value)
						}
					>
						<option value="">All sites</option>
						<For each={sites() ?? []}>
							{(s: SiteRow): JSX.Element => <option value={s.id}>{s.name}</option>}
						</For>
					</select>
				</label>
				<label>
					<span class="visually-hidden">Filter by location</span>
					<select
						aria-label="Filter by location"
						value={filterLocation()}
						onChange={(e: Event & { currentTarget: HTMLSelectElement }) =>
							setFilterLocation(e.currentTarget.value)
						}
					>
						<option value="">All locations</option>
						<For each={locations() ?? []}>
							{(l: LocationRow): JSX.Element => (
								<option value={l.id}>{l.name}</option>
							)}
						</For>
					</select>
				</label>
				<label>
					<span class="visually-hidden">Filter by tenant</span>
					<select
						aria-label="Filter by tenant"
						value={filterTenant()}
						onChange={(e: Event & { currentTarget: HTMLSelectElement }) =>
							setFilterTenant(e.currentTarget.value)
						}
					>
						<option value="">All tenants</option>
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
				getRowId={(r: RackRow): number => r.id}
				columns={columns}
				sortKey={sort}
				sortDirection={order}
				onSort={handleSort}
				showColumnCustomizer
				visibleColumns={visibleColumns}
				onVisibleColumnsChange={setVisibleColumns}
				selected={selected}
				onSelectionChange={(ids: (string | number)[]): void => {
					setSelected(ids.map((id) => Number(id)))
				}}
				selectionLabel="Select all racks"
				rowActions={(r: RackRow): JSX.Element => (
					<div class="row-actions">
						<button
							type="button"
							class="icon-btn"
							title={`Edit ${r.name}`}
							aria-label={`Edit rack ${r.name}`}
							onClick={() => navigate(`/racks/${r.id}/edit`)}
						>
							<IconPencil size={16} />
						</button>
						<div class="row-menu-wrap">
							<button
								type="button"
								class="icon-btn"
								aria-label={`More actions for ${r.name}`}
								aria-haspopup="menu"
								aria-expanded={openMenu()?.id === r.id}
								onClick={(
									e: MouseEvent & {
										currentTarget: HTMLButtonElement
									},
								): void => toggleMenu(e, r.id, r.name)}
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
				loading={() => racksPage.loading}
				loadingContent={<p class="skeleton">Loading racks…</p>}
				emptyContent={
					<p class="empty">
						{debouncedSearch() || filterSite() || filterLocation() || filterTenant()
							? 'No racks match the current filters.'
							: 'No racks yet. Add the first one above.'}
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
