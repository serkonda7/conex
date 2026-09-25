/** In-app tab navigation. Every tab keeps its own back/forward history and
 * stays mounted in the background (keep-alive in App.tsx). Plain link clicks
 * navigate inside the active tab; Ctrl/Cmd/Shift or middle click opens a new
 * tab. Add/edit/import forms always open as their own tab and close again
 * on save or cancel.
 *
 * Browser Back/Forward step through the active tab's history. Switching
 * tabs replaces the current browser history entry instead of pushing one.
 */
import { createContext, createSignal, useContext } from 'solid-js'

export interface TabState {
	id: number
	/** Visited paths, oldest first; `index` points at the shown one. */
	entries: readonly string[]
	index: number
	/** Shown path, always `entries[index]`. */
	path: string
	openerId: number | null
	/** Bumped to force a remount (fresh fetch) of the tab's page. */
	gen: number
}

export interface NavigateOptions {
	/** Force opening `to` in a new tab (e.g. Ctrl/Cmd+click). */
	openInTab?: boolean
	/** Replace the tab's current history entry instead of pushing. */
	replace?: boolean
	/**
	 * When closing a form tab into `to`, remount the target so it refetches.
	 * Defaults to true (save flow). Pass false for cancel/back so the
	 * underlying page keeps its exact contents.
	 */
	refresh?: boolean
}

const DEFAULT_PATH = '/tenants'

let nextTabId = 1

function makeTab(
	id: number,
	entries: readonly string[],
	index: number,
	openerId: number | null,
	gen = 0,
): TabState {
	return { id, entries, index, path: entries[index] ?? DEFAULT_PATH, openerId, gen }
}

function currentUrl(): string {
	return window.location.pathname + window.location.search
}

function initialPath(): string {
	if (typeof window === 'undefined') {
		return DEFAULT_PATH
	}
	return currentUrl() || DEFAULT_PATH
}

const [tabs, setTabs] = createSignal<TabState[]>([makeTab(nextTabId++, [initialPath()], 0, null)])
const [activeTabId, setActiveTabId] = createSignal<number>(tabs()[0]?.id ?? 1)
/** Names reported by loaded pages, tied to the path they were read from. */
const [tabLabels, setTabLabels] = createSignal<Record<number, { path: string; label: string }>>({})

/** Set when tags are created or deleted so the home view can refresh entries. */
const [tagsChanged, setTagsChanged] = createSignal(false)

/** Per-tab scroll positions, indexed like the tab's history entries. */
const scrollByTab = new Map<number, number[]>()

/**
 * Position of the current browser history entry. Stored in `history.state`
 * so popstate can tell Back (lower) from Forward (higher).
 */
let historySeq = 0

function readSeq(state: unknown): number | null {
	if (typeof state !== 'object' || state === null || !('seq' in state)) {
		return null
	}
	return typeof state.seq === 'number' ? state.seq : null
}

function pushUrl(to: string): void {
	historySeq += 1
	window.history.pushState({ seq: historySeq }, '', to)
}

function replaceUrl(to: string): void {
	window.history.replaceState({ seq: historySeq }, '', to)
}

function rememberScroll(tab: TabState): void {
	const list = scrollByTab.get(tab.id) ?? []
	list[tab.index] = window.scrollY
	scrollByTab.set(tab.id, list)
}

function restoreScroll(tab: TabState): void {
	window.scrollTo(0, scrollByTab.get(tab.id)?.[tab.index] ?? 0)
}

/** Active tab record (null only before init). A plain function (not a memo)
 * so it stays fresh at module scope, where a memo would have no owner. */
export function activeTab(): TabState | null {
	const id = activeTabId()
	return tabs().find((t) => t.id === id) ?? null
}

/** Current route path: the active tab's path. */
export function path(): string {
	return activeTab()?.path ?? DEFAULT_PATH
}

/** Path segments of a route, ignoring the query string and trailing slashes. */
export function routeSegments(raw: string): string[] {
	return (raw.split('?')[0] ?? '').split('/').filter((p) => p.length > 0)
}

/** Last path segment is add/edit/import: the route opens as a form tab. */
function isFormRoute(raw: string): boolean {
	const last = routeSegments(raw).at(-1)
	return last === 'add' || last === 'edit' || last === 'import'
}

/** Name the tab's loaded page reported, if the tab still shows that page. */
export function tabPageLabel(tab: TabState): string | undefined {
	const entry = tabLabels()[tab.id]
	return entry?.path === tab.path ? entry.label : undefined
}

export function setTabLabel(id: number, forPath: string, label: string): void {
	const entry = tabLabels()[id]
	if (!label || (entry?.path === forPath && entry.label === label)) {
		return
	}
	setTabLabels((current) => ({ ...current, [id]: { path: forPath, label } }))
}

function updateTab(next: TabState): void {
	setTabs((prev) => prev.map((t) => (t.id === next.id ? next : t)))
}

function removeTab(id: number): void {
	setTabs((prev) => prev.filter((t) => t.id !== id))
	scrollByTab.delete(id)
	setTabLabels(({ [id]: _, ...rest }) => rest)
}

/** Makes `tab` the visible one and mirrors its path in the address bar. */
function show(tab: TabState, url: 'push' | 'replace' = 'replace'): void {
	setActiveTabId(tab.id)
	if (url === 'push') {
		pushUrl(tab.path)
	} else {
		replaceUrl(tab.path)
	}
	restoreScroll(tab)
}

/** Adds `to` to the tab's history, dropping any forward entries. */
function visit(tab: TabState, to: string, replace = false): TabState {
	const kept = tab.entries.slice(0, replace ? tab.index : tab.index + 1)
	const next = makeTab(tab.id, [...kept, to], kept.length, tab.openerId, tab.gen)
	scrollByTab.get(tab.id)?.splice(next.index)
	updateTab(next)
	return next
}

function openTab(to: string, openerId: number | null): void {
	const tab = makeTab(nextTabId++, [to], 0, openerId)
	setTabs((prev) => [...prev, tab])
	show(tab)
}

/** Switch to an existing tab, preserving every tab's mounted state. */
export function activateTab(id: number): void {
	const tab = tabs().find((t) => t.id === id)
	if (!tab) {
		return
	}
	const active = activeTab()
	if (active?.id === id) {
		return
	}
	if (active) {
		rememberScroll(active)
	}
	show(tab)
}

/** Close a tab and focus its opener (or the nearest neighbor). */
export function closeTab(id: number): void {
	const list = tabs()
	const closing = list.find((t) => t.id === id)
	if (!closing || list.length === 1) {
		return
	}
	const remaining = list.filter((t) => t.id !== id)
	removeTab(id)
	if (activeTabId() !== id) {
		return
	}
	const opener =
		closing.openerId !== null ? remaining.find((t) => t.id === closing.openerId) : undefined
	const index = list.findIndex((t) => t.id === id)
	const fallback = opener ?? remaining[Math.min(index, remaining.length - 1)]
	if (fallback) {
		show(fallback)
	}
}

/**
 * Leaves a form tab for `to` (save, cancel, back link): the form closes
 * like a dialog and the target shows in an existing tab, else in the
 * opener's history, else in place of the form.
 */
function closeForm(form: TabState, to: string, refresh: boolean): void {
	const others = tabs().filter((t) => t.id !== form.id)
	const shown = others.find((t) => t.path === to)
	if (shown) {
		removeTab(form.id)
		const next = refresh ? { ...shown, gen: shown.gen + 1 } : shown
		updateTab(next)
		show(next)
		return
	}
	const opener = others.find((t) => t.id === form.openerId)
	if (opener && !isFormRoute(opener.path)) {
		removeTab(form.id)
		show(visit(opener, to), 'push')
		return
	}
	// Direct URL entry, or the opener is gone or is itself a form: turn the
	// form tab into the target.
	scrollByTab.delete(form.id)
	const next = makeTab(form.id, [to], 0, form.openerId, form.gen)
	updateTab(next)
	show(next)
}

/**
 * Navigate:
 * - form route (add/edit/import): focus the tab already showing it, else
 *   open a new tab
 * - `openInTab`: open a new tab
 * - from a form tab: close the form and show the target (see `closeForm`)
 * - otherwise: push `to` onto the active tab's history.
 */
export function navigate(to: string, opts: NavigateOptions = {}): void {
	const active = activeTab()
	if (!active) {
		openTab(to, null)
		return
	}
	rememberScroll(active)
	if (isFormRoute(to)) {
		const open = tabs().find((t) => t.path === to)
		if (open) {
			show(open)
		} else {
			openTab(to, active.id)
		}
		return
	}
	if (opts.openInTab === true) {
		openTab(to, active.id)
		return
	}
	if (isFormRoute(active.path)) {
		closeForm(active, to, opts.refresh ?? true)
		return
	}
	if (to === active.path) {
		if (opts.refresh === true) {
			updateTab({ ...active, gen: active.gen + 1 })
		}
		return
	}
	show(visit(active, to, opts.replace), opts.replace === true ? 'replace' : 'push')
}

/**
 * Click handler for in-app links: a plain click follows `navigate`,
 * Ctrl/Cmd/Shift or middle click opens the target in a new tab.
 */
export function goTo(e: MouseEvent, to: string, opts?: NavigateOptions): void {
	e.preventDefault()
	const newTab = e.ctrlKey || e.metaKey || e.shiftKey || e.button === 1
	navigate(to, newTab ? { ...opts, openInTab: true } : opts)
}

if (typeof window !== 'undefined') {
	historySeq = readSeq(window.history.state) ?? 0
	replaceUrl(initialPath())

	window.addEventListener('popstate', (e: PopStateEvent) => {
		const seq = readSeq(e.state)
		// Entries without a seq are in-page `#anchor` jumps: leave them alone.
		if (seq === null) {
			return
		}
		const step = seq - historySeq
		historySeq = seq
		const active = activeTab()
		if (!active) {
			return
		}
		const index = Math.max(0, Math.min(active.entries.length - 1, active.index + step))
		if (index !== active.index) {
			rememberScroll(active)
			const next = makeTab(active.id, active.entries, index, active.openerId, active.gen)
			updateTab(next)
			show(next)
			return
		}
		// The tab has no history left in that direction: keep showing it.
		if (currentUrl() !== active.path) {
			replaceUrl(active.path)
		}
	})
}

/**
 * Tab-local route path for data fetching. Pages keep calling `queryParam`
 * with no args; inside a tab pane it reads that tab's path instead of the
 * globally active one, so background tabs never cross-talk.
 */
const TabPathContext = createContext<string | null>(null)

export function tabPathContext(): ReturnType<typeof createContext<string | null>> {
	return TabPathContext
}

export function useTabPath(): string {
	return useContext(TabPathContext) ?? path()
}

/** Reads one query param from the current tab's route (e.g. `?tenant=<id>`). */
export function queryParam(key: string, fromPath?: string): string {
	const current = fromPath ?? useTabPath()
	const query = current.includes('?') ? (current.split('?')[1] ?? '') : ''
	return new URLSearchParams(query).get(key) ?? ''
}

/**
 * Parses a positive integer entity id from a URL segment or query value.
 * Returns null for missing or malformed values so callers can 404 cleanly.
 */
export function parseId(raw: string | null | undefined): number | null {
	if (raw === null || raw === undefined || raw === '') {
		return null
	}
	const id = Number(raw)
	return Number.isInteger(id) && id >= 1 ? id : null
}

export { activeTabId, setTagsChanged, tabs, tagsChanged }
