/** In-app tab navigation. Every tab keeps its own back/forward history and
 * stays mounted in the background (keep-alive in App.tsx). Plain link clicks
 * navigate inside the active tab; Ctrl/Cmd/Shift or middle click opens a new
 * tab. Add/edit/import forms always open as their own tab and close again
 * on save or cancel.
 *
 * Browser Back/Forward step through the active tab's history. Switching
 * tabs replaces the current browser history entry instead of pushing one.
 * Tabs are saved in `sessionStorage`, so a reload brings them back.
 */
import { Result } from 'better-result'
import {
	createContext,
	createEffect,
	createRoot,
	createSignal,
	untrack,
	useContext,
} from 'solid-js'

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

/** One breadcrumb link; the last crumb of a trail has no `href`. */
export interface Crumb {
	label: string
	href?: string
}

/** What a loaded page reports about itself for tab titles and breadcrumbs. */
export interface PageMeta {
	/** Display name of the shown object. */
	name?: string
	/** Ancestors of the object, outermost first (e.g. site › location › rack). */
	crumbs?: readonly Crumb[]
}

const DEFAULT_PATH = '/tenants'
const STORAGE_KEY = 'conex:tabs'

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

interface SavedTabs {
	tabs: TabState[]
	activeId: number
}

function isStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((v) => typeof v === 'string')
}

/** Rebuilds a saved tab, or null when the stored shape is off. */
function reviveTab(raw: unknown): TabState | null {
	if (typeof raw !== 'object' || raw === null) {
		return null
	}
	const { id, entries, index, openerId } = raw as Record<string, unknown>
	if (
		typeof id !== 'number' ||
		!isStringArray(entries) ||
		entries.length === 0 ||
		typeof index !== 'number' ||
		index < 0 ||
		index >= entries.length ||
		(openerId !== null && typeof openerId !== 'number')
	) {
		return null
	}
	return makeTab(id, entries, index, openerId)
}

function loadSavedTabs(): SavedTabs | null {
	const raw = Result.try(() => window.sessionStorage.getItem(STORAGE_KEY))
	if (Result.isError(raw) || raw.value === null) {
		return null
	}
	const stored = raw.value
	const parsed = Result.try((): unknown => JSON.parse(stored))
	if (Result.isError(parsed) || typeof parsed.value !== 'object' || parsed.value === null) {
		return null
	}
	const { tabs: rawTabs, activeId } = parsed.value as Record<string, unknown>
	if (!Array.isArray(rawTabs) || typeof activeId !== 'number') {
		return null
	}
	const revived = rawTabs.map(reviveTab)
	const valid = revived.filter((t): t is TabState => t !== null)
	if (valid.length === 0 || valid.length !== revived.length) {
		return null
	}
	return { tabs: valid, activeId }
}

/**
 * Tabs to start with: the saved ones when the reloaded URL is still shown
 * by one of them, else the saved ones plus a new tab for the URL.
 */
function initialTabs(): SavedTabs {
	const url = initialPath()
	const saved = typeof window === 'undefined' ? null : loadSavedTabs()
	if (!saved) {
		const tab = makeTab(nextTabId++, [url], 0, null)
		return { tabs: [tab], activeId: tab.id }
	}
	nextTabId = Math.max(...saved.tabs.map((t) => t.id)) + 1
	const active = saved.tabs.find((t) => t.id === saved.activeId)
	if (active?.path === url) {
		return saved
	}
	const showing = saved.tabs.find((t) => t.path === url)
	if (showing) {
		return { tabs: saved.tabs, activeId: showing.id }
	}
	const tab = makeTab(nextTabId++, [url], 0, active?.id ?? null)
	return { tabs: [...saved.tabs, tab], activeId: tab.id }
}

const initial = initialTabs()
const [tabs, setTabs] = createSignal<TabState[]>(initial.tabs)
const [activeTabId, setActiveTabId] = createSignal<number>(initial.activeId)
/** Metadata reported by loaded pages, keyed by route path. */
const [pageMeta, setPageMeta] = createSignal<Record<string, PageMeta>>({})

if (typeof window !== 'undefined') {
	createRoot(() => {
		createEffect(() => {
			const saved: SavedTabs = {
				tabs: tabs().map((t) => ({ ...t, gen: 0 })),
				activeId: activeTabId(),
			}
			// Storage can be full or disabled; tabs then just don't survive a reload.
			Result.try(() => window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(saved)))
		})
	})
}

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

/** Metadata the page at `forPath` last reported, if it has loaded. */
export function pageMetaFor(forPath: string): PageMeta | undefined {
	return pageMeta()[forPath]
}

/**
 * Lets a page report its object's name and ancestors for the tab title and
 * the breadcrumb bar. Kept after the page unmounts, so edit forms and
 * history entries can reuse it.
 */
export function usePageMeta(meta: () => PageMeta): void {
	const forPath = useTabPath()
	createEffect(() => {
		const next = meta()
		const current = untrack(() => pageMeta()[forPath])
		if (JSON.stringify(current) === JSON.stringify(next)) {
			return
		}
		setPageMeta((all) => ({ ...all, [forPath]: next }))
	})
}

function updateTab(next: TabState): void {
	setTabs((prev) => prev.map((t) => (t.id === next.id ? next : t)))
}

function removeTab(id: number): void {
	setTabs((prev) => prev.filter((t) => t.id !== id))
	scrollByTab.delete(id)
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

/** Opens a copy of a tab, history included, right after it. */
export function duplicateTab(id: number): void {
	const source = tabs().find((t) => t.id === id)
	const active = activeTab()
	if (!source) {
		return
	}
	if (active) {
		rememberScroll(active)
	}
	const copy = makeTab(nextTabId++, source.entries, source.index, source.id)
	scrollByTab.set(copy.id, [...(scrollByTab.get(source.id) ?? [])])
	setTabs((prev) => prev.flatMap((t) => (t.id === id ? [t, copy] : [t])))
	show(copy)
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

/** Closes every tab except `id` and shows it. */
export function closeOtherTabs(id: number): void {
	const keep = tabs().find((t) => t.id === id)
	if (!keep) {
		return
	}
	for (const tab of tabs()) {
		if (tab.id !== id) {
			scrollByTab.delete(tab.id)
		}
	}
	setTabs([keep])
	if (activeTabId() !== id) {
		show(keep)
	}
}

/** Closes the tabs after `id`; shows `id` if the active tab was among them. */
export function closeTabsToRight(id: number): void {
	const list = tabs()
	const index = list.findIndex((t) => t.id === id)
	const keep = list[index]
	if (!keep) {
		return
	}
	const closing = list.slice(index + 1)
	for (const tab of closing) {
		scrollByTab.delete(tab.id)
	}
	setTabs(list.slice(0, index + 1))
	if (closing.some((t) => t.id === activeTabId())) {
		show(keep)
	}
}

/** The route shows the object at `objectPath` or one of its sub-pages. */
function showsObject(route: string, objectPath: string): boolean {
	const bare = route.split('?')[0] ?? ''
	return bare === objectPath || bare.startsWith(`${objectPath}/`)
}

/**
 * After the object at `objectPath` (e.g. `/devices/12`) was deleted: drop
 * it and its edit page from every tab's history and close tabs left with
 * nothing. The active tab falls back to its previous entry, else the list
 * tab at `listRoute` or its opener; tabs showing the list are refreshed.
 */
export function forgetDeleted(objectPath: string, listRoute: string): void {
	const list = tabs()
	const activeId = activeTabId()
	const next: TabState[] = []
	for (const tab of list) {
		const kept = tab.entries.flatMap((entry, i) => (showsObject(entry, objectPath) ? [] : [i]))
		if (kept.length === tab.entries.length) {
			const isList = (tab.path.split('?')[0] ?? '') === listRoute
			next.push(isList ? { ...tab, gen: tab.gen + 1 } : tab)
			continue
		}
		if (kept.length === 0) {
			continue
		}
		// Stay on the current entry if it survived, else step back to the
		// nearest earlier one.
		const before = kept.filter((i) => i <= tab.index)
		const index = before.length > 0 ? before.length - 1 : 0
		const scroll = scrollByTab.get(tab.id)
		if (scroll) {
			scrollByTab.set(
				tab.id,
				kept.map((i) => scroll[i] ?? 0),
			)
		}
		next.push(
			makeTab(
				tab.id,
				kept.map((i) => tab.entries[i] ?? listRoute),
				index,
				tab.openerId,
				tab.gen + 1,
			),
		)
	}
	for (const tab of list) {
		if (!next.some((t) => t.id === tab.id)) {
			scrollByTab.delete(tab.id)
		}
	}
	const survivor = next.find((t) => t.id === activeId)
	if (survivor) {
		setTabs(next)
		show(survivor)
		return
	}
	const closed = list.find((t) => t.id === activeId)
	const target =
		next.find((t) => (t.path.split('?')[0] ?? '') === listRoute) ??
		next.find((t) => t.id === closed?.openerId)
	if (target) {
		setTabs(next)
		show(target)
		return
	}
	// Nothing to fall back to: the tab stays and shows the list instead.
	const replacement = makeTab(activeId, [listRoute], 0, closed?.openerId ?? null)
	const at = list.findIndex((t) => t.id === activeId)
	const withReplacement = [...next]
	withReplacement.splice(Math.min(at, withReplacement.length), 0, replacement)
	setTabs(withReplacement)
	show(replacement)
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
	replaceUrl(path())

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
