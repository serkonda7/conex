/**
 * Shared building blocks for the entity list pages (tenants, sites,
 * devices, …). `useEntityList` owns the list state (debounced search, sort,
 * the fetched page, row delete) and
 * `EntityListPage` renders the standard page around it: header with
 * "+ Add", filter table (quick search, filters) with row actions and row
 * menu, range status and error line.
 *
 * Write actions (add, edit, delete) render only when the
 * session can write. `noun` options take a `noun.<entity>` plural key used
 * to build localized confirm/aria/status text.
 */

import type { ComboboxOption } from '@serkonda7/solid-components'
import { IconCopy, IconDotsVertical, IconPencil, IconTrash } from '@tabler/icons-solidjs'
import { Result } from 'better-result'
import type { Page, Permission } from 'shared/src/types'
import {
	type Accessor,
	type Component,
	createEffect,
	createMemo,
	createResource,
	createSignal,
	For,
	type JSX,
	onCleanup,
	onMount,
	type Resource,
	type Setter,
	Show,
} from 'solid-js'
import { Portal } from 'solid-js/web'
import { type PluralKey, t, tp } from '../i18n'
import { use_visible_columns } from '../lib/column_visibility'
import { useDismiss } from '../lib/dismiss'
import { type RemoveFn, removeConfirmingFloorplan } from '../lib/floorplan_delete'
import { navigate, parseId, queryParam } from '../lib/router'
import { can } from '../lib/session'
import {
	type DataTableColumn,
	FilterTable,
	type FilterTableFilter,
	type FilterTableValues,
} from './data_table'
import { Empty, InlineError, Loading } from './feedback'

/** Search text plus its debounced (trimmed) projection for list queries. */
export function useDebouncedSearch(delay = 250): {
	search: Accessor<string>
	setSearch: Setter<string>
	debouncedSearch: Accessor<string>
} {
	const [search, setSearch] = createSignal('')
	const [debouncedSearch, setDebouncedSearch] = createSignal('')

	let debounceTimer: number | undefined
	createEffect(() => {
		const q = search()
		window.clearTimeout(debounceTimer)
		debounceTimer = window.setTimeout(() => {
			setDebouncedSearch(q.trim())
		}, delay)
	})
	onCleanup(() => {
		window.clearTimeout(debounceTimer)
	})

	return { search, setSearch, debouncedSearch }
}

/** Sortable-column state for a DataTable: toggle on repeat, reset on clear. */
export function useSort<T extends string>(
	initial: T | undefined,
): {
	sort: Accessor<T | undefined>
	order: Accessor<'asc' | 'desc'>
	handleSort: (key: string) => void
	clearSort: () => void
} {
	const [sort, setSort] = createSignal<T | undefined>(initial)
	const [order, setOrder] = createSignal<'asc' | 'desc'>('asc')

	function handleSort(key: string): void {
		const col = key as T
		if (sort() === col) {
			setOrder(order() === 'asc' ? 'desc' : 'asc')
		} else {
			setSort(() => col)
			setOrder('asc')
		}
	}

	function clearSort(): void {
		setSort(undefined)
		setOrder('asc')
	}

	return { sort, order, handleSort, clearSort }
}

/**
 * Filter value seeded from the tab's `?<key>=` query (deep links such as
 * `/sites?tenant=<id>` from detail pages); the toolbar changes it from there.
 */
export function useQueryFilter(key: string): [Accessor<string>, Setter<string>] {
	return createSignal(queryParam(key))
}

/**
 * Multi-value counterpart of {@link useQueryFilter}: seeded from a
 * `?<key>=1,2` query, empty when absent.
 */
export function useQueryFilterList(key: string): [Accessor<string[]>, Setter<string[]>] {
	return createSignal(queryParam(key).split(',').filter(Boolean))
}

/** Chosen option values as ids for a server filter; `undefined` when none is set. */
export function idsOf(values: readonly string[]): number[] | undefined {
	const ids = values.flatMap((v) => parseId(v) ?? [])
	return ids.length > 0 ? ids : undefined
}

/**
 * Multi-choice server-side filter shown in the FilterTable's Filters tab.
 * `value` holds the chosen option values as strings (`[]` = any).
 */
export interface ListFilter {
	key: string
	label: string
	options: ComboboxOption[]
	value: Accessor<string[]>
	onChange: (value: string[]) => void
}

/**
 * Binds the search signal (FilterTable's quick search, `q`) and the
 * multi-value `filters` to a server-filtered FilterTable.
 */
export function useListFilters<Row>(opts: {
	search: Accessor<string>
	setSearch: (value: string) => void
	filters?: () => readonly ListFilter[] | undefined
}): {
	filters: () => FilterTableFilter<Row>[]
	filterValues: () => FilterTableValues
	onFilterValuesChange: (values: FilterTableValues) => void
	/** Whether any filter (not the search) is set. */
	filtered: () => boolean
} {
	const list = (): readonly ListFilter[] => opts.filters?.() ?? []
	return {
		filters: () =>
			list().map(
				(f: ListFilter): FilterTableFilter<Row> => ({
					key: f.key,
					label: f.label,
					type: 'select',
					options: f.options,
				}),
			),
		filterValues: () => {
			const values: FilterTableValues = { q: opts.search() }
			for (const f of list()) {
				if (f.value().length > 0) {
					values[f.key] = [...f.value()]
				}
			}
			return values
		},
		onFilterValuesChange: (values: FilterTableValues): void => {
			const q = values.q
			opts.setSearch(typeof q === 'string' ? q : '')
			// Diff against a snapshot first: a handler may reset a dependent
			// filter (site → location), which must not be undone here.
			const changed = list().flatMap((f: ListFilter) => {
				const v = values[f.key]
				const next = Array.isArray(v) ? v : v ? [v] : []
				const prev = f.value()
				return next.length === prev.length && next.every((x, i) => x === prev[i])
					? []
					: [{ f, next }]
			})
			for (const { f, next } of changed) {
				f.onChange(next)
			}
		},
		filtered: () => list().some((f: ListFilter) => f.value().length > 0),
	}
}

/** `{ id, name }` rows as filter options keyed by the stringified id. */
export function idOptions(
	rows: readonly { id: number; name: string }[] | undefined,
): ComboboxOption[] {
	return (rows ?? []).map((r) => ({ value: String(r.id), label: r.name }))
}

/** Persisted visible-column state for a DataTable column customizer. */
export function useTableColumns(
	storage_key: string,
	all_keys: string[],
	default_keys?: string[],
): [Accessor<string[]>, (visible: string[]) => void] {
	return use_visible_columns(storage_key, all_keys, default_keys ?? all_keys)
}

/** Extra row-menu item beside Clone and Delete. */
export interface RowMenuAction {
	label: string
	icon: Component<{ size?: number }>
	onSelect: () => void
}

/**
 * Anchor for the row menu, rendered in a Portal so the table's scroll
 * container can never clip it. `edge` is a viewport `top` offset when
 * opening downward, a `bottom` offset when flipped upward.
 */
export interface RowMenuAnchor {
	/** Row key (`getRowId`), unique within the list. */
	key: string | number
	name: string
	edge: number
	right: number
	up: boolean
}

/** Three-item menu height estimate; only the upward flip depends on it. */
const ROW_MENU_HEIGHT = 140
const ROW_MENU_GAP = 4

/**
 * Anchors the row menu to its toggle button in viewport coordinates,
 * flipped upward when there is no room below (e.g. the last table row).
 */
function anchorBelow(button: HTMLElement, key: string | number, name: string): RowMenuAnchor {
	const rect = button.getBoundingClientRect()
	const spaceBelow = window.innerHeight - rect.bottom - ROW_MENU_GAP
	const spaceAbove = rect.top - ROW_MENU_GAP
	const up = spaceBelow < ROW_MENU_HEIGHT && spaceAbove >= ROW_MENU_HEIGHT
	return {
		key,
		name,
		edge: up ? window.innerHeight - rect.top + ROW_MENU_GAP : rect.bottom + ROW_MENU_GAP,
		right: Math.max(0, window.innerWidth - rect.right),
		up,
	}
}

/** Viewport-anchored row menu with outside/scroll/resize dismiss. */
export function useRowMenu(): {
	openMenu: Accessor<RowMenuAnchor | null>
	closeMenu: () => void
	toggleMenu: (
		e: MouseEvent & { currentTarget: HTMLButtonElement },
		key: string | number,
		name: string,
	) => void
} {
	const [openMenu, setOpenMenu] = createSignal<RowMenuAnchor | null>(null)
	function closeMenu(): void {
		setOpenMenu(null)
	}

	// The portaled menu sits outside its toggle's wrapper, so both count as inside.
	useDismiss('.row-menu-wrap, .row-menu', closeMenu)
	onMount(() => {
		// The menu is viewport-anchored, so any scroll or resize dismisses it
		// too instead of leaving it adrift.
		window.addEventListener('scroll', closeMenu, true)
		window.addEventListener('resize', closeMenu)
		onCleanup(() => {
			window.removeEventListener('scroll', closeMenu, true)
			window.removeEventListener('resize', closeMenu)
		})
	})

	function toggleMenu(
		e: MouseEvent & { currentTarget: HTMLButtonElement },
		key: string | number,
		name: string,
	): void {
		setOpenMenu(openMenu()?.key === key ? null : anchorBelow(e.currentTarget, key, name))
	}

	return { openMenu, closeMenu, toggleMenu }
}

/** Everything `EntityListPage` needs from {@link useEntityList}. */
export interface EntityList<Row> {
	noun: PluralKey
	search: Accessor<string>
	setSearch: Setter<string>
	debouncedSearch: Accessor<string>
	sort: Accessor<string | undefined>
	order: Accessor<'asc' | 'desc'>
	handleSort: (key: string) => void
	clearSort: () => void
	page: Resource<Page<Row> | null>
	rows: Accessor<Row[]>
	total: Accessor<number>
	error: Accessor<string | null>
	setError: Setter<string | null>
	/** Whether the session may add/edit rows (`manage`, else `edit`). */
	canEdit: () => boolean
	/** Whether the session may delete rows (`manage`, else `delete`). */
	canDelete: () => boolean
	handleDelete: (row: Row, name: string) => Promise<void>
	/** Refetches the current page (after a change made outside the list). */
	reload: () => void
}

/**
 * State of a standard list page: search, sort and the page-specific
 * `filters` form the query for `fetch`. Deletes confirm first, report through `error` and
 * refetch. Omit `sort` for endpoints without sorting; `manage` replaces the
 * `edit`/`delete` permissions for admin lists (users, roles). `removeOf`
 * picks the delete call per row for lists mixing kinds (devices and VMs).
 */
export function useEntityList<
	Row extends { id: number },
	Sort extends string,
	F extends object,
>(opts: {
	noun: PluralKey
	sort?: Sort
	manage?: Permission
	filters?: () => F
	fetch: (
		query: { search: string; sort?: Sort; order: 'asc' | 'desc' } & F,
	) => Promise<Result<Page<Row>, Error>>
	remove: RemoveFn
	removeOf?: (row: Row) => RemoveFn
}): EntityList<Row> {
	const canEdit = (): boolean => can(opts.manage ?? 'edit')
	const canDelete = (): boolean => can(opts.manage ?? 'delete')
	const [error, setError] = createSignal<string | null>(null)
	const { search, setSearch, debouncedSearch } = useDebouncedSearch()
	const { sort, order, handleSort, clearSort } = useSort<Sort>(opts.sort)

	const query = createMemo(() => ({
		search: debouncedSearch(),
		sort: sort() ?? opts.sort,
		order: order(),
		...(opts.filters?.() ?? ({} as F)),
	}))

	const [page, { refetch }] = createResource(query, async (q) => {
		const res = await opts.fetch(q)
		if (Result.isError(res)) {
			setError(res.error.message)
			return null
		}
		return res.value
	})

	async function handleDelete(row: Row, name: string): Promise<void> {
		if (!window.confirm(t('list.confirmDelete', { noun: tp(opts.noun, 1), name }))) {
			return
		}
		setError(null)
		const remove = opts.removeOf?.(row) ?? opts.remove
		const res = await removeConfirmingFloorplan(remove, row.id, name)
		if (Result.isError(res)) {
			setError(res.error.message)
			return
		}
		if (res.value) {
			void refetch()
		}
	}

	return {
		noun: opts.noun,
		search,
		setSearch,
		debouncedSearch,
		sort,
		order,
		handleSort,
		clearSort,
		page,
		rows: () => page()?.items ?? [],
		total: () => page()?.total ?? 0,
		error,
		setError,
		canEdit,
		canDelete,
		handleDelete,
		reload: (): void => void refetch(),
	}
}

/** One entry of {@link ListTabs}. */
export interface ListTab {
	label: string
	href: string
	active: boolean
}

/**
 * Sibling-list navigation (tenants ↔ tenant groups, sites ↔ site groups)
 * rendered in place of the list title, so switching costs no extra row.
 * Anchors keep the tabs deep-linkable; the active one gets
 * `aria-current="page"`.
 */
function ListTabs(props: { title: string; tabs: readonly ListTab[] }): JSX.Element {
	return (
		<nav class="list-tabs" aria-label={props.title}>
			<h2 class="visually-hidden">{props.title}</h2>
			<For each={props.tabs}>
				{(tab: ListTab): JSX.Element => (
					<a href={tab.href} aria-current={tab.active ? 'page' : undefined}>
						{tab.label}
					</a>
				)}
			</For>
		</nav>
	)
}

/**
 * Standard list page around {@link useEntityList}. `filters` populate the
 * table's Filters tab; `filtered` tells the empty message whether something
 * beyond them (e.g. the tenant context) narrows the list. Without `editHref`
 * the rows only get the menu toggle.
 */
export function EntityListPage<Row extends { id: number }>(props: {
	list: EntityList<Row>
	title: string
	/** Sibling-list tabs shown instead of the title. */
	tabs?: readonly ListTab[]
	addHref: string
	/** Extra header buttons beside "+ Add" (e.g. Import). */
	headerActions?: JSX.Element
	filters?: readonly ListFilter[]
	filtered?: boolean
	columns: DataTableColumn<Row>[]
	/** Storage key of the persisted column choice and the saved filters. */
	columnsKey: string
	defaultColumns?: string[]
	rowName: (row: Row) => string
	/** Row key when ids are not unique within the list (mixed kinds); defaults to `id`. */
	rowKey?: (row: Row) => string | number
	editHref?: (row: Row) => string
	/** Add form pre-filled from a row; omitted leaves "Clone" out of the row menu. */
	cloneHref?: (row: Row) => string
	/** Further row-menu items between Clone and Delete; empty hides the item. */
	menuActions?: (row: Row) => readonly RowMenuAction[]
	/** Rows that can never be deleted (e.g. built-in records). */
	deletable?: (row: Row) => boolean
	emptyText: string
}): JSX.Element {
	const list = props.list
	const nouns = (): string => tp(list.noun, 2)
	const { openMenu, closeMenu, toggleMenu } = useRowMenu()
	const [visibleColumns, setVisibleColumns] = useTableColumns(
		props.columnsKey,
		props.columns.map((c) => c.key),
		props.defaultColumns,
	)
	const filters = useListFilters<Row>({
		search: list.search,
		setSearch: list.setSearch,
		filters: () => props.filters,
	})

	function emptyMessage(): string {
		if (props.filtered === true || filters.filtered()) {
			return t('list.noMatchFilters', { noun: nouns() })
		}
		const search = list.debouncedSearch()
		return search ? t('list.noMatch', { noun: nouns(), search }) : props.emptyText
	}

	const cloneable = (): boolean => list.canEdit() && props.cloneHref !== undefined
	const actionsOf = (row: Row): readonly RowMenuAction[] => props.menuActions?.(row) ?? []
	const deletableRow = (row: Row): boolean => list.canDelete() && props.deletable?.(row) !== false
	const keyOf = (row: Row): string | number => props.rowKey?.(row) ?? row.id
	const menuRow = (menu: RowMenuAnchor): Row | undefined =>
		list.rows().find((r) => keyOf(r) === menu.key)

	function rowActions(row: Row): JSX.Element {
		const name = props.rowName(row)
		return (
			<ListRowActions
				edit_href={list.canEdit() ? props.editHref?.(row) : undefined}
				has_menu={cloneable() || actionsOf(row).length > 0 || deletableRow(row)}
				name={name}
				menu_open={openMenu()?.key === keyOf(row)}
				onToggleMenu={(e: MouseEvent & { currentTarget: HTMLButtonElement }): void =>
					toggleMenu(e, keyOf(row), name)
				}
				onCloseMenu={closeMenu}
			/>
		)
	}

	return (
		<div>
			<ListPageHeader
				title={props.title}
				tabs={props.tabs}
				add_href={props.addHref}
				actions={props.headerActions}
				can_add={list.canEdit()}
			/>

			<FilterTable
				rows={list.rows}
				filters={filters.filters()}
				filterValues={filters.filterValues}
				onFilterValuesChange={filters.onFilterValuesChange}
				savedFiltersKey={props.columnsKey}
				manualFiltering
				quickSearchLabel={t('list.searchLabel', { noun: nouns() })}
				getRowId={keyOf}
				columns={props.columns}
				sortKey={list.sort}
				sortDirection={list.order}
				onSort={list.handleSort}
				onSortClear={list.clearSort}
				showColumnCustomizer
				visibleColumns={visibleColumns}
				onVisibleColumnsChange={setVisibleColumns}
				rowActions={list.canEdit() || list.canDelete() ? rowActions : undefined}
				loading={() => list.page.loading}
				loadingContent={<Loading message={t('list.loading', { noun: nouns() })} />}
				emptyContent={<Empty message={emptyMessage()} />}
			/>

			<ListRangeStatus shown={list.rows().length} total={list.total()} />

			<RowMenu
				menu={openMenu}
				onClose={closeMenu}
				cloneHref={(menu: RowMenuAnchor): string | undefined => {
					const row = menuRow(menu)
					return cloneable() && row ? props.cloneHref?.(row) : undefined
				}}
				actions={(menu: RowMenuAnchor): readonly RowMenuAction[] => {
					const row = menuRow(menu)
					return row ? actionsOf(row) : []
				}}
				deletable={(menu: RowMenuAnchor): boolean => {
					const row = menuRow(menu)
					return row !== undefined && deletableRow(row)
				}}
				onDelete={(menu: RowMenuAnchor): void => {
					const row = menuRow(menu)
					if (row) {
						void list.handleDelete(row, menu.name)
					}
				}}
			/>

			<InlineError message={list.error()} />
		</div>
	)
}

/**
 * List title (or sibling-list `tabs`) plus the "+ Add" button. `actions` renders extra header buttons
 * (e.g. the device-type Import button) beside "+ Add" inside a
 * `page-header-actions` wrapper. Both are write actions, hidden unless
 * `can_add`.
 */
function ListPageHeader(props: {
	title: string
	tabs?: readonly ListTab[]
	add_href: string
	actions?: JSX.Element
	can_add: boolean
}): JSX.Element {
	const addButton = (
		<button type="button" class="btn-add" onClick={(): void => navigate(props.add_href)}>
			{t('common.add')}
		</button>
	)
	return (
		<div class="page-header">
			{/* The app tab already names the page; keep the heading for screen readers. */}
			<Show when={props.tabs} fallback={<h2 class="visually-hidden">{props.title}</h2>}>
				{(tabs: () => readonly ListTab[]): JSX.Element => (
					<ListTabs title={props.title} tabs={tabs()} />
				)}
			</Show>
			<Show when={props.can_add}>
				<Show when={props.actions !== undefined} fallback={addButton}>
					<div class="page-header-actions">
						{addButton}
						{props.actions}
					</div>
				</Show>
			</Show>
		</div>
	)
}

/**
 * Per-row edit button plus the row-menu toggle. `edit_href` is optional:
 * lists without an edit page (rack types) render the menu toggle only.
 * `has_menu: false` drops the menu toggle (no menu item to offer).
 * `name` is the row's display name used in the button labels.
 */
function ListRowActions(props: {
	edit_href?: string
	has_menu: boolean
	name: string
	menu_open: boolean
	onToggleMenu: (e: MouseEvent & { currentTarget: HTMLButtonElement }) => void
	onCloseMenu: () => void
}): JSX.Element {
	return (
		<div class="row-actions">
			<Show when={props.edit_href}>
				{(href: () => string) => (
					<button
						type="button"
						class="icon-btn"
						title={t('common.editNamed', { name: props.name })}
						aria-label={t('common.editNamed', { name: props.name })}
						onClick={() => navigate(href())}
					>
						<IconPencil size={16} />
					</button>
				)}
			</Show>
			<Show when={props.has_menu}>
				<div class="row-menu-wrap">
					<button
						type="button"
						class="icon-btn"
						aria-label={t('common.moreActionsFor', { name: props.name })}
						aria-haspopup="menu"
						aria-expanded={props.menu_open}
						onClick={props.onToggleMenu}
						onKeyDown={(e: KeyboardEvent): void => {
							if (e.key === 'Escape') {
								props.onCloseMenu()
							}
						}}
					>
						<IconDotsVertical size={16} />
					</button>
				</div>
			</Show>
		</div>
	)
}

/** Portal row menu with the Clone, extra action and Delete items a row offers. */
export function RowMenu(props: {
	menu: Accessor<RowMenuAnchor | null>
	onClose: () => void
	/** Clone target of the menu's row; undefined hides "Clone". */
	cloneHref: (menu: RowMenuAnchor) => string | undefined
	actions: (menu: RowMenuAnchor) => readonly RowMenuAction[]
	deletable: (menu: RowMenuAnchor) => boolean
	onDelete: (menu: RowMenuAnchor) => void
}): JSX.Element {
	const closeOnEscape = (e: KeyboardEvent): void => {
		if (e.key === 'Escape') {
			props.onClose()
		}
	}
	return (
		<Show when={props.menu()}>
			{(menu: () => RowMenuAnchor) => (
				<Portal>
					<div
						class="row-menu"
						role="menu"
						aria-label={t('common.actionsFor', { name: menu().name })}
						style={{
							top: menu().up ? undefined : `${menu().edge}px`,
							bottom: menu().up ? `${menu().edge}px` : undefined,
							right: `${menu().right}px`,
						}}
					>
						<Show when={props.cloneHref(menu())}>
							{(href: () => string) => (
								<button
									type="button"
									role="menuitem"
									class="row-menu-item"
									onClick={() => {
										props.onClose()
										navigate(href())
									}}
									onKeyDown={closeOnEscape}
								>
									<IconCopy size={16} />
									{t('common.clone')}
								</button>
							)}
						</Show>
						<For each={props.actions(menu())}>
							{(action: RowMenuAction): JSX.Element => (
								<button
									type="button"
									role="menuitem"
									class="row-menu-item"
									onClick={() => {
										props.onClose()
										action.onSelect()
									}}
									onKeyDown={closeOnEscape}
								>
									<action.icon size={16} />
									{action.label}
								</button>
							)}
						</For>
						<Show when={props.deletable(menu())}>
							<button
								type="button"
								role="menuitem"
								class="row-menu-item row-menu-danger"
								onClick={() => {
									const current = menu()
									props.onClose()
									props.onDelete(current)
								}}
								onKeyDown={closeOnEscape}
							>
								<IconTrash size={16} />
								{t('common.delete')}
							</button>
						</Show>
					</div>
				</Portal>
			)}
		</Show>
	)
}

/**
 * "Showing 1-N of M" line under the table. Lists fetch only their first
 * page, so `shown` (the rendered rows) can end before `total`.
 */
export function ListRangeStatus(props: { shown: number; total: number }): JSX.Element {
	return (
		<p class="paginator-showing" role="status">
			{t('list.range', {
				from: props.shown === 0 ? 0 : 1,
				to: props.shown,
				total: props.total,
			})}
		</p>
	)
}
