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
	onCleanup,
	onMount,
	Show,
} from 'solid-js'
import { Portal } from 'solid-js/web'
import { delete_tenant, fetch_tenants, type TenantSort, type TenantWithCounts } from '../api_p1'
import { navigate } from '../router'
import { use_visible_columns } from '../util/column_visibility'

function go(e: MouseEvent, to: string): void {
	e.preventDefault()
	navigate(to)
}

/**
 * /tenants — NetBox-style tenant list: search, sortable columns, row
 * selection with bulk delete, and icon actions with delete in a row menu.
 * Editing lives on the dedicated /tenants/:id/edit page. The whole result
 * set renders at once (API cap: 200).
 */
export function TenantsPage(): JSX.Element {
	const [error, setError] = createSignal<string | null>(null)
	const [search, setSearch] = createSignal('')
	const [debouncedSearch, setDebouncedSearch] = createSignal('')
	const [sort, setSort] = createSignal<TenantSort | undefined>('name')
	const [order, setOrder] = createSignal<'asc' | 'desc'>('asc')
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
	}))

	const [tenantsPage, { refetch }] = createResource(listSource, async (s) => {
		const res = await fetch_tenants(s)
		if (Result.isError(res)) {
			setError(res.error.message)
			return null
		}
		return res.value
	})

	const rows = createMemo(() => tenantsPage()?.items ?? [])
	const total = createMemo(() => tenantsPage()?.total ?? 0)
	const rangeStart = createMemo(() => (total() === 0 ? 0 : 1))
	const rangeEnd = createMemo(() => total())

	// A new result set invalidates the checkbox selection.
	createEffect(() => {
		listSource()
		setSelected([])
	})

	function handleSort(key: string): void {
		const col = key as TenantSort
		if (sort() === col) {
			setOrder(order() === 'asc' ? 'desc' : 'asc')
		} else {
			setSort(col)
			setOrder('asc')
		}
	}

	const columns: DataTableColumn<TenantWithCounts>[] = [
		{
			key: 'name',
			label: 'Tenant',
			sortable: true,
			getValue: (t: TenantWithCounts): JSX.Element => (
				<a
					href={`/tenants/${t.id}`}
					onClick={(e: MouseEvent): void => go(e, `/tenants/${t.id}`)}
				>
					{t.name}
				</a>
			),
		},
		{
			key: 'description',
			label: 'Description',
			sortable: true,
			class: 'cell-truncate',
			getValue: (t: TenantWithCounts): JSX.Element => (
				<span title={t.description ?? ''}>{t.description || '—'}</span>
			),
		},
	]

	const tenant_column_keys = columns.map((c) => c.key)
	const [visibleColumns, setVisibleColumns] = use_visible_columns('tenants', tenant_column_keys)

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
		if (!window.confirm(`Delete tenant "${name}"?`)) {
			return
		}
		setError(null)
		const res = await delete_tenant(id)
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
		if (!window.confirm(`Delete ${ids.length} tenant${ids.length === 1 ? '' : 's'}?`)) {
			return
		}
		setError(null)
		const failures: string[] = []
		for (const id of ids) {
			const res = await delete_tenant(id)
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
				<h2>Tenants</h2>
				<button type="button" class="btn-add" onClick={() => navigate('/tenants/add')}>
					+ Add
				</button>
			</div>

			<div class="toolbar-row">
				<label class="toolbar-search">
					<span class="visually-hidden">Search tenants</span>
					<input
						type="search"
						class="toolbar-search-input"
						placeholder="Search name, slug, description…"
						aria-label="Search tenants"
						value={search()}
						onInput={(e: InputEventAndTarget) => setSearch(e.currentTarget.value)}
					/>
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
				getRowId={(t: TenantWithCounts): number => t.id}
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
				selectionLabel="Select all tenants"
				rowActions={(t: TenantWithCounts): JSX.Element => (
					<div class="row-actions">
						<button
							type="button"
							class="icon-btn"
							title={`Edit ${t.name}`}
							aria-label={`Edit tenant ${t.name}`}
							onClick={() => navigate(`/tenants/${t.id}/edit`)}
						>
							<IconPencil size={16} />
						</button>
						<div class="row-menu-wrap">
							<button
								type="button"
								class="icon-btn"
								aria-label={`More actions for ${t.name}`}
								aria-haspopup="menu"
								aria-expanded={openMenu()?.id === t.id}
								onClick={(
									e: MouseEvent & {
										currentTarget: HTMLButtonElement
									},
								): void => toggleMenu(e, t.id, t.name)}
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
				loading={() => tenantsPage.loading}
				loadingContent={<p class="skeleton">Loading tenants…</p>}
				emptyContent={
					<p class="empty">
						{debouncedSearch()
							? `No tenants match "${debouncedSearch()}".`
							: 'No tenants yet. Add the first one above.'}
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
