/**
 * Shared building blocks for the entity list pages (tenants, sites,
 * devices, …): debounced search, sort state, checkbox selection, the
 * viewport-anchored row menu, single/bulk delete flows, and the
 * header/toolbar/row-action/status/error shells.
 *
 * Every piece preserves the exact DOM and aria structure the pages rendered
 * before, so e2e selectors keep working. `noun` options take a
 * `noun.<entity>` plural key used to build localized confirm/aria text.
 */

import { IconDotsVertical, IconPencil, IconTrash } from '@tabler/icons-solidjs'
import { Result } from 'better-result'
import type { InputEventAndTarget } from 'shared/src/types'
import {
	type Accessor,
	createEffect,
	createSignal,
	type JSX,
	onCleanup,
	onMount,
	type Setter,
	Show,
} from 'solid-js'
import { Portal } from 'solid-js/web'
import { type PluralKey, t, tp } from '../i18n'
import { navigate } from '../router'
import { use_visible_columns } from '../util/column_visibility'

/** Wraps a plain anchor so in-page links use the history router. */
export function go(e: MouseEvent, to: string): void {
	e.preventDefault()
	navigate(to)
}

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
	setSort: Setter<T | undefined>
	order: Accessor<'asc' | 'desc'>
	setOrder: Setter<'asc' | 'desc'>
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

	return { sort, setSort, order, setOrder, handleSort, clearSort }
}

/**
 * Checkbox selection for a DataTable. `track` is the list-query memo: a new
 * result set invalidates the selection. `selection` spreads straight into
 * the DataTable's selection props.
 */
export function useListSelection(
	track: () => unknown,
	noun: PluralKey,
): {
	selected: Accessor<number[]>
	setSelected: Setter<number[]>
	selection: {
		selected: Accessor<number[]>
		onSelectionChange: (ids: (string | number)[]) => void
		selectionLabel: string
	}
} {
	const [selected, setSelected] = createSignal<number[]>([])

	// A new result set invalidates the checkbox selection.
	createEffect(() => {
		track()
		setSelected([])
	})

	function onSelectionChange(ids: (string | number)[]): void {
		setSelected(ids.map((id) => Number(id)))
	}

	const selectionLabel = t('list.selectAll', { noun: tp(noun, 2) })
	return { selected, setSelected, selection: { selected, onSelectionChange, selectionLabel } }
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

	return { openMenu, closeMenu, toggleMenu }
}

/**
 * Confirm-then-delete flows shared by every deletable list: a single-row
 * delete (by menu) and a bulk delete over the checkbox selection. Both
 * report through `setError` and refresh through `refetch`.
 */
export function useListDelete(opts: {
	noun: PluralKey
	remove: (id: number) => Promise<Result<unknown, Error>>
	setError: Setter<string | null>
	refetch: () => void
	selected: Accessor<number[]>
	setSelected: Setter<number[]>
}): {
	handleDelete: (id: number, name: string) => Promise<void>
	handleBulkDelete: () => Promise<void>
} {
	async function handleDelete(id: number, name: string): Promise<void> {
		if (!window.confirm(t('list.confirmDelete', { noun: tp(opts.noun, 1), name }))) {
			return
		}
		opts.setError(null)
		const res = await opts.remove(id)
		if (Result.isError(res)) {
			opts.setError(res.error.message)
			return
		}
		opts.setSelected((prev) => prev.filter((s) => s !== id))
		void opts.refetch()
	}

	async function handleBulkDelete(): Promise<void> {
		const ids = opts.selected()
		if (ids.length === 0) {
			return
		}
		const noun = tp(opts.noun, ids.length)
		if (!window.confirm(t('list.confirmBulkDelete', { count: ids.length, noun }))) {
			return
		}
		opts.setError(null)
		const failures: string[] = []
		for (const id of ids) {
			const res = await opts.remove(id)
			if (Result.isError(res)) {
				failures.push(res.error.message)
			}
		}
		opts.setSelected([])
		if (failures.length > 0) {
			opts.setError(failures[0] ?? t('list.bulkDeleteFailed'))
		}
		void opts.refetch()
	}

	return { handleDelete, handleBulkDelete }
}

/**
 * List title plus the "+ Add" button. `actions` renders extra header buttons
 * (e.g. the device-type Import button) beside "+ Add" inside the same
 * `page-header-actions` wrapper the hand-rolled page used.
 */
export function ListPageHeader(props: {
	title: string
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
			<h2>{props.title}</h2>
			<Show when={props.actions !== undefined} fallback={addButton}>
				<div class="page-header-actions">
					{addButton}
					{props.actions}
				</div>
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
		<Show when={props.count > 0}>
			<button type="button" class="btn-danger" onClick={props.onClick}>
				{t('list.deleteSelected', { count: props.count })}
			</button>
		</Show>
	)
}

/**
 * Per-row edit button plus the row-menu toggle. `edit_href` is optional:
 * lists without an edit page (rack types) render the menu toggle only.
 * `name` is the row's display name used in the button labels.
 */
export function ListRowActions(props: {
	edit_href?: string
	name: string
	menu_open: boolean
	onToggleMenu: (e: MouseEvent & { currentTarget: HTMLButtonElement }) => void
	onCloseMenu: () => void
}): JSX.Element {
	return (
		<div class="row-actions">
			<Show when={props.edit_href !== undefined}>
				<button
					type="button"
					class="icon-btn"
					title={t('common.editNamed', { name: props.name })}
					aria-label={t('common.editNamed', { name: props.name })}
					onClick={() => navigate(props.edit_href ?? '')}
				>
					<IconPencil size={16} />
				</button>
			</Show>
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
		<Show when={props.menu() !== null}>
			<Portal>
				<div
					class="row-menu"
					role="menu"
					aria-label={t('common.actionsFor', { name: props.menu()?.name ?? '' })}
					style={{
						top: props.menu()?.up ? undefined : `${props.menu()?.edge ?? 0}px`,
						bottom: props.menu()?.up ? `${props.menu()?.edge ?? 0}px` : undefined,
						right: `${props.menu()?.right ?? 0}px`,
					}}
				>
					<button
						type="button"
						role="menuitem"
						class="row-menu-danger"
						onClick={() => {
							const menu = props.menu()
							props.onClose()
							if (menu) {
								props.onDelete(menu)
							}
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

/** Terminal list error line. */
export function ListError(props: { message: string | null }): JSX.Element {
	return (
		<Show when={props.message}>
			<div class="app-inline-error">{props.message}</div>
		</Show>
	)
}
