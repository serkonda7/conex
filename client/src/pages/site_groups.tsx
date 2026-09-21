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
	delete_site_group,
	fetch_site_groups,
	fetch_tenants,
	type SiteGroupRow,
	type SiteGroupSort,
	type TenantRow,
} from '../api_p1'
import { navigate, parseId, queryParam } from '../router'

function go(e: MouseEvent, to: string): void {
	e.preventDefault()
	navigate(to)
}

/**
 * /site-groups — NetBox-style site group list: search, sortable columns,
 * parent column, row selection with bulk delete, and icon actions with
 * delete in a row menu. Editing lives on the dedicated
 * /site-groups/:id/edit page. The whole result set renders at once
 * (API cap: 200).
 */
export function SiteGroupsPage(): JSX.Element {
	const [error, setError] = createSignal<string | null>(null)
	const [search, setSearch] = createSignal('')
	const [debouncedSearch, setDebouncedSearch] = createSignal('')
	const [sort, setSort] = createSignal<SiteGroupSort>('name')
	const [order, setOrder] = createSignal<'asc' | 'desc'>('asc')
	const [selected, setSelected] = createSignal<number[]>([])
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

	// Follow tenant links from the tenant detail page (`/site-groups?tenant=<id>`).
	createEffect(() => {
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

	const listSource = createMemo(() => ({
		search: debouncedSearch(),
		sort: sort(),
		order: order(),
		tenant: parseId(filterTenant()) ?? undefined,
	}))

	const [groupsPage, { refetch }] = createResource(listSource, async (s) => {
		const res = await fetch_site_groups(s)
		if (Result.isError(res)) {
			setError(res.error.message)
			return null
		}
		return res.value
	})

	const rows = createMemo(() => groupsPage()?.items ?? [])
	const total = createMemo(() => groupsPage()?.total ?? 0)
	const rangeStart = createMemo(() => (total() === 0 ? 0 : 1))
	const rangeEnd = createMemo(() => total())

	const [tenants] = createResource(async () => {
		const res = await fetch_tenants()
		if (Result.isError(res)) {
			setError(res.error.message)
			return []
		}
		return res.value.items
	})

	function tenantNameOf(id: number | null): string {
		if (!id) {
			return '—'
		}
		return tenants()?.find((t: TenantRow) => t.id === id)?.name ?? String(id)
	}

	// Id → name map for the Parent column, resolved from the same result set.
	const parentNameOf = createMemo(() => {
		const byId = new Map<number, string>()
		for (const g of rows()) {
			byId.set(g.id, g.name)
		}
		return (id: number | null): string => {
			if (id === null || id === undefined) {
				return '—'
			}
			return byId.get(id) ?? String(id)
		}
	})

	// A new result set invalidates the checkbox selection.
	createEffect(() => {
		listSource()
		setSelected([])
	})

	function toggleSort(col: SiteGroupSort): void {
		if (sort() === col) {
			setOrder(order() === 'asc' ? 'desc' : 'asc')
		} else {
			setSort(col)
			setOrder('asc')
		}
	}

	function sortIndicator(col: SiteGroupSort): string {
		if (sort() !== col) {
			return ''
		}
		return order() === 'asc' ? ' ▲' : ' ▼'
	}

	function ariaSort(col: SiteGroupSort): 'ascending' | 'descending' | 'none' {
		if (sort() !== col) {
			return 'none'
		}
		return order() === 'asc' ? 'ascending' : 'descending'
	}

	function isSelected(id: number): boolean {
		return selected().includes(id)
	}

	function toggleSelected(id: number): void {
		setSelected((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]))
	}

	function toggleSelectAll(checked: boolean): void {
		setSelected(checked ? rows().map((g) => g.id) : [])
	}

	const allVisibleSelected = createMemo(
		() => rows().length > 0 && rows().every((g) => isSelected(g.id)),
	)
	let selectAllRef: HTMLInputElement | undefined
	createEffect(() => {
		if (selectAllRef) {
			const some = selected().length > 0
			selectAllRef.indeterminate = some && !allVisibleSelected()
		}
	})

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
		if (!window.confirm(`Delete site group "${name}"?`)) {
			return
		}
		setError(null)
		const res = await delete_site_group(id)
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
		if (!window.confirm(`Delete ${ids.length} site group${ids.length === 1 ? '' : 's'}?`)) {
			return
		}
		setError(null)
		const failures: string[] = []
		for (const id of ids) {
			const res = await delete_site_group(id)
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
				<h2>Site Groups</h2>
				<button type="button" class="btn-add" onClick={() => navigate('/site-groups/add')}>
					+ Add
				</button>
			</div>

			<div class="toolbar-row">
				<label class="toolbar-search">
					<span class="visually-hidden">Search site groups</span>
					<input
						type="search"
						class="toolbar-search-input"
						placeholder="Search name, slug, description…"
						aria-label="Search site groups"
						value={search()}
						onInput={(e: InputEventAndTarget) => setSearch(e.currentTarget.value)}
					/>
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

			<table>
				<thead>
					<tr>
						<th class="cell-checkbox">
							<span class="visually-hidden">Select rows</span>
							<input
								ref={selectAllRef}
								type="checkbox"
								aria-label="Select all site groups"
								checked={allVisibleSelected()}
								onChange={(e: Event & { currentTarget: HTMLInputElement }) =>
									toggleSelectAll(e.currentTarget.checked)
								}
							/>
						</th>
						<th aria-sort={ariaSort('name')}>
							<button
								type="button"
								class="sort-th"
								onClick={() => toggleSort('name')}
							>
								Group{sortIndicator('name')}
							</button>
						</th>
						<th aria-sort={ariaSort('description')}>
							<button
								type="button"
								class="sort-th"
								onClick={() => toggleSort('description')}
							>
								Description{sortIndicator('description')}
							</button>
						</th>
						<th>Parent</th>
						<th>Tenant</th>
						<th>Actions</th>
					</tr>
				</thead>
				<tbody>
					<For each={rows()}>
						{(g: SiteGroupRow): JSX.Element => (
							<tr>
								<td class="cell-checkbox">
									<input
										type="checkbox"
										aria-label={`Select site group ${g.name}`}
										checked={isSelected(g.id)}
										onChange={() => toggleSelected(g.id)}
									/>
								</td>
								<td>
									<a
										href={`/site-groups/${g.id}`}
										onClick={(e: MouseEvent): void =>
											go(e, `/site-groups/${g.id}`)
										}
									>
										{g.name}
									</a>
								</td>
								<td class="cell-truncate" title={g.description ?? ''}>
									{g.description || '—'}
								</td>
								<td>{parentNameOf()(g.parent_id)}</td>
								<td>{tenantNameOf(g.tenant_id)}</td>
								<td>
									<div class="row-actions">
										<button
											type="button"
											class="icon-btn"
											title={`Edit ${g.name}`}
											aria-label={`Edit site group ${g.name}`}
											onClick={() => navigate(`/site-groups/${g.id}/edit`)}
										>
											<IconPencil size={16} />
										</button>
										<div class="row-menu-wrap">
											<button
												type="button"
												class="icon-btn"
												aria-label={`More actions for ${g.name}`}
												aria-haspopup="menu"
												aria-expanded={openMenu()?.id === g.id}
												onClick={(
													e: MouseEvent & {
														currentTarget: HTMLButtonElement
													},
												): void => toggleMenu(e, g.id, g.name)}
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
								</td>
							</tr>
						)}
					</For>
				</tbody>
			</table>

			<Show when={groupsPage.loading}>
				<p class="skeleton">Loading site groups…</p>
			</Show>
			<Show when={!groupsPage.loading && rows().length === 0}>
				<p class="empty">
					{debouncedSearch() || filterTenant()
						? 'No site groups match the current filters.'
						: 'No site groups yet. Add the first one above.'}
				</p>
			</Show>

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
