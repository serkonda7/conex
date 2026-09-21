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
	delete_location,
	fetch_locations,
	fetch_sites,
	fetch_tenants,
	type LocationRow,
	type LocationSort,
	type SiteRow,
	type TenantRow,
} from '../api_p1'
import { navigate, parseId, queryParam } from '../router'
import { use_visible_columns } from '../util/column_visibility'

function go(e: MouseEvent, to: string): void {
	e.preventDefault()
	navigate(to)
}

/**
 * /locations — NetBox-style location list: search, sortable columns, site +
 * tenant filters (deep-linkable via `?site=<id>` / `?tenant=<id>`), row
 * selection with bulk delete, and icon actions with delete in a row menu.
 * Editing lives on the dedicated /locations/:id/edit page. The whole
 * result set renders at once (API cap: 200).
 */
export function LocationsPage(): JSX.Element {
	const [error, setError] = createSignal<string | null>(null)
	const [search, setSearch] = createSignal('')
	const [debouncedSearch, setDebouncedSearch] = createSignal('')
	const [sort, setSort] = createSignal<LocationSort>('name')
	const [order, setOrder] = createSignal<'asc' | 'desc'>('asc')
	const [selected, setSelected] = createSignal<number[]>([])
	const [filterSite, setFilterSite] = createSignal(queryParam('site'))
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

	// Follow site/tenant links from detail pages (`/locations?site=<id>`).
	createEffect(() => {
		setFilterSite(queryParam('site'))
		setFilterTenant(queryParam('tenant'))
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

	const listSource = createMemo(() => ({
		search: debouncedSearch(),
		site: parseId(filterSite()) ?? undefined,
		tenant: parseId(filterTenant()) ?? undefined,
		sort: sort(),
		order: order(),
	}))

	const [locationsPage, { refetch }] = createResource(listSource, async (s) => {
		const res = await fetch_locations(s)
		if (Result.isError(res)) {
			setError(res.error.message)
			return null
		}
		return res.value
	})

	const rows = createMemo(() => locationsPage()?.items ?? [])
	const total = createMemo(() => locationsPage()?.total ?? 0)
	const rangeStart = createMemo(() => (total() === 0 ? 0 : 1))
	const rangeEnd = createMemo(() => total())

	// A new result set invalidates the checkbox selection.
	createEffect(() => {
		listSource()
		setSelected([])
	})

	function siteNameOf(siteId: number): string {
		return sites()?.find((s: SiteRow) => s.id === siteId)?.name ?? String(siteId)
	}

	// Keep the parent value available when the optional Parent column is
	// enabled through the column customizer.
	const parentNameOf = createMemo(() => {
		const byId = new Map<number, string>()
		for (const l of rows()) {
			byId.set(l.id, l.name)
		}
		return (id: number | null): string =>
			id === null || id === undefined ? '—' : (byId.get(id) ?? String(id))
	})

	// Derive the nesting level from the parent links so the table can show the
	// hierarchy without spending a column on the parent name. The visited set
	// also keeps a malformed response from causing an infinite loop.
	const locationDepthOf = createMemo(() => {
		const parentOf = new Map<number, number | null>()
		for (const l of rows()) {
			parentOf.set(l.id, l.parent_id)
		}
		return (location: LocationRow): number => {
			let depth = 0
			let parent = location.parent_id
			const visited = new Set<number>([location.id])
			while (parent !== null && parentOf.has(parent) && !visited.has(parent)) {
				visited.add(parent)
				depth += 1
				parent = parentOf.get(parent) ?? null
			}
			return depth
		}
	})

	function tenantNameOf(id: number | null): string {
		if (!id) {
			return '—'
		}
		return tenants()?.find((t: TenantRow) => t.id === id)?.name ?? String(id)
	}

	function handleSort(key: string): void {
		const col = key as LocationSort
		if (sort() === col) {
			setOrder(order() === 'asc' ? 'desc' : 'asc')
		} else {
			setSort(col)
			setOrder('asc')
		}
	}

	const columns: DataTableColumn<LocationRow>[] = [
		{
			key: 'name',
			label: 'Location',
			sortable: true,
			getValue: (l: LocationRow): JSX.Element => (
				<div
					class={`location-tree-name${locationDepthOf()(l) > 0 ? ' location-tree-child' : ''}`}
					style={{ '--location-depth': locationDepthOf()(l) }}
				>
					<a
						href={`/locations/${l.id}`}
						onClick={(e: MouseEvent): void => go(e, `/locations/${l.id}`)}
					>
						{l.name}
					</a>
				</div>
			),
		},
		{
			key: 'site',
			label: 'Site',
			getValue: (l: LocationRow): string => siteNameOf(l.site_id),
		},
		{
			key: 'parent',
			label: 'Parent',
			getValue: (l: LocationRow): string => parentNameOf()(l.parent_id),
		},
		{
			key: 'tenant',
			label: 'Tenant',
			getValue: (l: LocationRow): string => tenantNameOf(l.tenant_id),
		},
	]

	const location_column_keys = columns.map((c) => c.key)
	const [visibleColumns, setVisibleColumns] = use_visible_columns(
		'locations',
		location_column_keys,
		['name', 'site', 'tenant'],
	)

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
		if (!window.confirm(`Delete location "${name}"?`)) {
			return
		}
		setError(null)
		const res = await delete_location(id)
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
		if (!window.confirm(`Delete ${ids.length} location${ids.length === 1 ? '' : 's'}?`)) {
			return
		}
		setError(null)
		const failures: string[] = []
		for (const id of ids) {
			const res = await delete_location(id)
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
				<h2>Locations</h2>
				<button type="button" class="btn-add" onClick={() => navigate('/locations/add')}>
					+ Add
				</button>
			</div>

			<div class="toolbar-row">
				<label class="toolbar-search">
					<span class="visually-hidden">Search locations</span>
					<input
						type="search"
						class="toolbar-search-input"
						placeholder="Search name, slug…"
						aria-label="Search locations"
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
							setFilterSite(e.currentTarget.value)
						}
					>
						<option value="">All sites</option>
						<For each={sites() ?? []}>
							{(s: SiteRow): JSX.Element => <option value={s.id}>{s.name}</option>}
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
				getRowId={(l: LocationRow): number => l.id}
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
				selectionLabel="Select all locations"
				rowActions={(l: LocationRow): JSX.Element => (
					<div class="row-actions">
						<button
							type="button"
							class="icon-btn"
							title={`Edit ${l.name}`}
							aria-label={`Edit location ${l.name}`}
							onClick={() => navigate(`/locations/${l.id}/edit`)}
						>
							<IconPencil size={16} />
						</button>
						<div class="row-menu-wrap">
							<button
								type="button"
								class="icon-btn"
								aria-label={`More actions for ${l.name}`}
								aria-haspopup="menu"
								aria-expanded={openMenu()?.id === l.id}
								onClick={(
									e: MouseEvent & {
										currentTarget: HTMLButtonElement
									},
								): void => toggleMenu(e, l.id, l.name)}
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
				loading={() => locationsPage.loading}
				loadingContent={<p class="skeleton">Loading locations…</p>}
				emptyContent={
					<p class="empty">
						{debouncedSearch() || filterSite() || filterTenant()
							? 'No locations match the current filters.'
							: 'No locations yet. Add the first one above.'}
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
