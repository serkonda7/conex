/**
 * Shared building blocks for the entity list pages (tenants, sites,
 * devices, …). `useEntityList` owns the list state (debounced search, sort,
 * the fetched page, checkbox selection, single/bulk delete) and
 * `EntityListPage` renders the standard page around it: header with
 * "+ Add", search/filter toolbar, table with row actions and row menu,
 * range status and error line.
 *
 * Write actions (add, edit, delete, bulk selection) render only when the
 * session can write. `noun` options take a `noun.<entity>` plural key used
 * to build localized confirm/aria/status text.
 */

import { IconDotsVertical, IconPencil, IconTrash } from '@tabler/icons-solidjs'
import { Result } from 'better-result'
import type { InputEventAndTarget, Page } from 'shared/src/types'
import {
	type Accessor,
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
import { navigate, queryParam } from '../lib/router'
import { can } from '../lib/session'
import { DataTable, type DataTableColumn } from './data_table'
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

/** Persisted visible-column state for a DataTable column customizer. */
export function useTableColumns(
	storage_key: string,
	all_keys: string[],
	default_keys?: string[],
): [Accessor<string[]>, (visible: string[]) => void] {
	return use_visible_columns(storage_key, all_keys, default_keys ?? all_keys)
}

/**
 * Anchor for the row menu, rendered in a Portal so the table's scroll
 * container can never clip it. `edge` is a viewport `top` offset when
 * opening downward, a `bottom` offset when flipped upward.
 */
export interface RowMenuAnchor {
	id: number
	name: string
	edge: number
	right: number
	up: boolean
}

/** Single-item menu height estimate; only the upward flip depends on it. */
const ROW_MENU_HEIGHT = 64
const ROW_MENU_GAP = 4

/**
 * Anchors the row menu to its toggle button in viewport coordinates,
 * flipped upward when there is no room below (e.g. the last table row).
 */
function anchorBelow(button: HTMLElement, id: number, name: string): RowMenuAnchor {
	const rect = button.getBoundingClientRect()
	const spaceBelow = window.innerHeight - rect.bottom - ROW_MENU_GAP
	const spaceAbove = rect.top - ROW_MENU_GAP
	const up = spaceBelow < ROW_MENU_HEIGHT && spaceAbove >= ROW_MENU_HEIGHT
	return {
		id,
		name,
		edge: up ? window.innerHeight - rect.top + ROW_MENU_GAP : rect.bottom + ROW_MENU_GAP,
		right: Math.max(0, window.innerWidth - rect.right),
		up,
	}
}

/** Viewport-anchored single-item row menu with outside/scroll/resize dismiss. */
export function useRowMenu(): {
	openMenu: Accessor<RowMenuAnchor | null>
	closeMenu: () => void
	toggleMenu: (
		e: MouseEvent & { currentTarget: HTMLButtonElement },
		id: number,
		name: string,
	) => void
} {
	const [openMenu, setOpenMenu] = createSignal<RowMenuAnchor | null>(null)
	function closeMenu(): void {
		setOpenMenu(null)
	}

	onMount(() => {
		// The menu is viewport-anchored, so any scroll or resize dismisses it
		// too instead of leaving it adrift.
		const onDocClick = (e: MouseEvent): void => {
			if (e.target instanceof Element && e.target.closest('.row-menu-wrap') === null) {
				closeMenu()
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

	function toggleMenu(
		e: MouseEvent & { currentTarget: HTMLButtonElement },
		id: number,
		name: string,
	): void {
		setOpenMenu(openMenu()?.id === id ? null : anchorBelow(e.currentTarget, id, name))
	}

	return { openMenu, closeMenu, toggleMenu }
}

/** DataTable selection props; read-only sessions get no checkboxes. */
export interface SelectionProps {
	selected: Accessor<number[]> | undefined
	onSelectionChange: ((ids: (string | number)[]) => void) | undefined
	selectionLabel: string
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
	selected: Accessor<number[]>
	selection: SelectionProps
	handleDelete: (id: number, name: string) => Promise<void>
	handleBulkDelete: () => Promise<void>
}

/**
 * State of a standard list page: search, sort and the page-specific
 * `filters` form the query for `fetch`; a new result set clears the
 * checkbox selection. Deletes confirm first, report through `error` and
 * refetch.
 */
export function useEntityList<
	Row extends { id: number },
	Sort extends string,
	F extends object,
>(opts: {
	noun: PluralKey
	sort: Sort
	filters?: () => F
	fetch: (
		query: { search: string; sort: Sort; order: 'asc' | 'desc' } & F,
	) => Promise<Result<Page<Row>, Error>>
	remove: (id: number) => Promise<Result<unknown, Error>>
}): EntityList<Row> {
	const [error, setError] = createSignal<string | null>(null)
	const { search, setSearch, debouncedSearch } = useDebouncedSearch()
	const { sort, order, handleSort, clearSort } = useSort<Sort>(opts.sort)
	const [selected, setSelected] = createSignal<number[]>([])

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

	// A new result set invalidates the checkbox selection.
	createEffect(() => {
		query()
		setSelected([])
	})

	async function handleDelete(id: number, name: string): Promise<void> {
		if (!window.confirm(t('list.confirmDelete', { noun: tp(opts.noun, 1), name }))) {
			return
		}
		setError(null)
		const res = await opts.remove(id)
		if (Result.isError(res)) {
			setError(res.error.message)
			return
		}
		setSelected((prev) => prev.filter((s) => s !== id))
		void refetch()
	}

	async function handleBulkDelete(): Promise<void> {
		const ids = selected()
		const noun = tp(opts.noun, ids.length)
		if (
			ids.length === 0 ||
			!window.confirm(t('list.confirmBulkDelete', { count: ids.length, noun }))
		) {
			return
		}
		setError(null)
		const failures: string[] = []
		for (const id of ids) {
			const res = await opts.remove(id)
			if (Result.isError(res)) {
				failures.push(res.error.message)
			}
		}
		setSelected([])
		if (failures.length > 0) {
			setError(failures[0] ?? t('list.bulkDeleteFailed'))
		}
		void refetch()
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
		selected,
		selection: {
			get selected(): Accessor<number[]> | undefined {
				return can('delete') ? selected : undefined
			},
			get onSelectionChange(): ((ids: (string | number)[]) => void) | undefined {
				return can('delete')
					? (ids: (string | number)[]): void => {
							setSelected(ids.map(Number))
						}
					: undefined
			},
			selectionLabel: t('list.selectAll', { noun: tp(opts.noun, 2) }),
		},
		handleDelete,
		handleBulkDelete,
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
 * Standard list page around {@link useEntityList}. `filters` are extra
 * toolbar controls; `filtered` tells the empty message whether they (or
 * the tenant context) narrow the list. Without `editHref` the rows only get
 * the menu toggle.
 */
export function EntityListPage<Row extends { id: number }>(props: {
	list: EntityList<Row>
	title: string
	/** Sibling-list tabs shown instead of the title. */
	tabs?: readonly ListTab[]
	addHref: string
	/** Extra header buttons beside "+ Add" (e.g. Import). */
	headerActions?: JSX.Element
	searchPlaceholder: string
	filters?: JSX.Element
	filtered?: boolean
	/** Defaults to true; false drops the checkboxes and "Delete selected". */
	bulkDelete?: boolean
	columns: DataTableColumn<Row>[]
	/** Storage key of the persisted column choice. */
	columnsKey: string
	defaultColumns?: string[]
	rowName: (row: Row) => string
	editHref?: (row: Row) => string
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
	const bulk = (): boolean => props.bulkDelete !== false

	function emptyMessage(): string {
		if (props.filtered === true) {
			return t('list.noMatchFilters', { noun: nouns() })
		}
		const search = list.debouncedSearch()
		return search ? t('list.noMatch', { noun: nouns(), search }) : props.emptyText
	}

	function rowActions(row: Row): JSX.Element {
		const name = props.rowName(row)
		return (
			<ListRowActions
				edit_href={can('edit') ? props.editHref?.(row) : undefined}
				deletable={can('delete') && props.deletable?.(row) !== false}
				name={name}
				menu_open={openMenu()?.id === row.id}
				onToggleMenu={(e: MouseEvent & { currentTarget: HTMLButtonElement }): void =>
					toggleMenu(e, row.id, name)
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
			/>

			<div class="toolbar-row">
				<ListSearchField
					label={t('list.searchLabel', { noun: nouns() })}
					placeholder={props.searchPlaceholder}
					value={list.search()}
					onInput={list.setSearch}
				/>
				{props.filters}
				<span class="toolbar-spacer" />
				<Show when={bulk()}>
					<BulkDeleteButton
						count={list.selected().length}
						onClick={list.handleBulkDelete}
					/>
				</Show>
			</div>

			<DataTable
				rows={list.rows}
				getRowId={(row: Row): number => row.id}
				columns={props.columns}
				sortKey={list.sort}
				sortDirection={list.order}
				onSort={list.handleSort}
				onSortClear={list.clearSort}
				showColumnCustomizer
				visibleColumns={visibleColumns}
				onVisibleColumnsChange={setVisibleColumns}
				selected={bulk() ? list.selection.selected : undefined}
				onSelectionChange={bulk() ? list.selection.onSelectionChange : undefined}
				selectionLabel={list.selection.selectionLabel}
				rowActions={can('edit') || can('delete') ? rowActions : undefined}
				loading={() => list.page.loading}
				loadingContent={<Loading message={t('list.loading', { noun: nouns() })} />}
				emptyContent={<Empty message={emptyMessage()} />}
			/>

			<ListRangeStatus total={list.total()} />

			<RowMenu
				menu={openMenu}
				onClose={closeMenu}
				onDelete={(menu: RowMenuAnchor): void => void list.handleDelete(menu.id, menu.name)}
			/>

			<InlineError message={list.error()} />
		</div>
	)
}

/**
 * Toolbar `<select>` narrowing a list: an "all" entry followed by `rows`.
 * The value is the chosen row id as a string (`''` = all).
 */
export function FilterSelect(props: {
	label: string
	allLabel: string
	value: string
	onChange: (value: string) => void
	rows: readonly { id: number; name: string }[]
}): JSX.Element {
	return (
		<label>
			<span class="visually-hidden">{props.label}</span>
			<select
				aria-label={props.label}
				value={props.value}
				onChange={(e: Event & { currentTarget: HTMLSelectElement }): void =>
					props.onChange(e.currentTarget.value)
				}
			>
				<option value="">{props.allLabel}</option>
				<For each={props.rows}>
					{(row: { id: number; name: string }): JSX.Element => (
						<option value={row.id}>{row.name}</option>
					)}
				</For>
			</select>
		</label>
	)
}

/**
 * List title (or sibling-list `tabs`) plus the "+ Add" button. `actions` renders extra header buttons
 * (e.g. the device-type Import button) beside "+ Add" inside a
 * `page-header-actions` wrapper. Both are write actions, hidden without
 * the `edit` permission.
 */
export function ListPageHeader(props: {
	title: string
	tabs?: readonly ListTab[]
	add_href: string
	actions?: JSX.Element
}): JSX.Element {
	const addButton = (
		<button type="button" class="btn-add" onClick={(): void => navigate(props.add_href)}>
			{t('common.add')}
		</button>
	)
	return (
		<div class="page-header">
			<Show when={props.tabs} fallback={<h2>{props.title}</h2>}>
				{(tabs: () => readonly ListTab[]): JSX.Element => (
					<ListTabs title={props.title} tabs={tabs()} />
				)}
			</Show>
			<Show when={can('edit')}>
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

/** Search input in the list toolbar row. */
export function ListSearchField(props: {
	label: string
	placeholder: string
	value: string
	onInput: (value: string) => void
}): JSX.Element {
	return (
		<label class="toolbar-search">
			<span class="visually-hidden">{props.label}</span>
			<input
				type="search"
				class="toolbar-search-input"
				placeholder={props.placeholder}
				aria-label={props.label}
				value={props.value}
				onInput={(e: InputEventAndTarget) => props.onInput(e.currentTarget.value)}
			/>
		</label>
	)
}

/** "Delete N selected" toolbar button, visible only with a selection. */
export function BulkDeleteButton(props: { count: number; onClick: () => void }): JSX.Element {
	return (
		<Show when={props.count > 0 && can('delete')}>
			<button type="button" class="btn-danger" onClick={props.onClick}>
				{t('list.deleteSelected', { count: props.count })}
			</button>
		</Show>
	)
}

/**
 * Per-row edit button plus the row-menu toggle. `edit_href` is optional:
 * lists without an edit page (rack types) render the menu toggle only.
 * `deletable: false` drops the menu toggle (its only item is Delete).
 * `name` is the row's display name used in the button labels.
 */
export function ListRowActions(props: {
	edit_href?: string
	deletable?: boolean
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
			<Show when={props.deletable !== false}>
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

/** Portal row menu with the single Delete item. */
export function RowMenu(props: {
	menu: Accessor<RowMenuAnchor | null>
	onClose: () => void
	onDelete: (menu: RowMenuAnchor) => void
}): JSX.Element {
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
						<button
							type="button"
							role="menuitem"
							class="row-menu-danger"
							onClick={() => {
								const current = menu()
								props.onClose()
								props.onDelete(current)
							}}
							onKeyDown={(e: KeyboardEvent): void => {
								if (e.key === 'Escape') {
									props.onClose()
								}
							}}
						>
							<IconTrash size={16} />
							{t('common.delete')}
						</button>
					</div>
				</Portal>
			)}
		</Show>
	)
}

/** "Showing 1-N of N" line under the table. */
export function ListRangeStatus(props: { total: number }): JSX.Element {
	return (
		<p class="paginator-showing" role="status">
			{t('list.range', {
				from: props.total === 0 ? 0 : 1,
				to: props.total,
				total: props.total,
			})}
		</p>
	)
}
