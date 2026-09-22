/** Smart tab navigation: object pages and add/edit/import routes open as
 * new tabs so the underlying list/detail keeps its state. List-to-list
 * browsing reuses the active tab; switching tabs keeps every page mounted
 * (keep-alive in App.tsx).
 */
import { createContext, createSignal, useContext } from 'solid-js'

export interface TabState {
	id: number
	path: string
	openerId: number | null
	/** Bumped to force a remount (fresh fetch) of the tab's page. */
	gen: number
}

export interface NavigateOptions {
	/** Force opening `to` in a new tab (e.g. Ctrl/Cmd+click). */
	openInTab?: boolean
	/** Replace history entry instead of pushing. */
	replace?: boolean
	/**
	 * When closing a form tab into `to`, remount the target so it refetches.
	 * Defaults to true (save flow). Pass false for cancel/back so the
	 * underlying page keeps its exact contents.
	 */
	refresh?: boolean
}

let nextTabId = 1

function initialPath(): string {
	if (typeof window === 'undefined') {
		return '/tenants'
	}
	return window.location.pathname + window.location.search || '/tenants'
}

const [tabs, setTabs] = createSignal<TabState[]>([
	{ id: nextTabId++, path: initialPath(), openerId: null, gen: 0 },
])
const [activeTabId, setActiveTabId] = createSignal<number>(tabs()[0]?.id ?? 1)

/** Set when tags are created or deleted so the home view can refresh entries. */
const [tagsChanged, setTagsChanged] = createSignal(false)

/** Per-tab scroll positions so switching tabs restores where you were. */
const scrollByTab = new Map<number, number>()

function syncUrl(to: string, replace?: boolean): void {
	if (typeof window === 'undefined') {
		return
	}
	const current = window.location.pathname + window.location.search
	if (current === to) {
		return
	}
	if (replace) {
		window.history.replaceState(null, '', to)
	} else {
		window.history.pushState(null, '', to)
	}
}

function rememberScroll(id: number): void {
	if (typeof window === 'undefined') {
		return
	}
	scrollByTab.set(id, window.scrollY)
}

function restoreScroll(id: number): void {
	if (typeof window === 'undefined') {
		return
	}
	const y = scrollByTab.get(id) ?? 0
	window.scrollTo(0, y)
}

/** Active tab record (null only before init). A plain function (not a memo)
 * so it stays fresh at module scope, where a memo would have no owner. */
export function activeTab(): TabState | null {
	const id = activeTabId()
	return tabs().find((t) => t.id === id) ?? null
}

/** Current route path: the active tab's path. Kept as a function so all
 * existing `path()` call sites keep working. */
export function path(): string {
	return activeTab()?.path ?? '/tenants'
}

/** Last path segment is add/edit/import (query strings ignored). */
export function isOverlayRoute(raw: string): boolean {
	const base = (raw.split('?')[0] ?? '').replace(/\/+$/, '') || '/'
	const segments = base.split('/').filter((p) => p.length > 0)
	const last = segments[segments.length - 1] ?? ''
	return last === 'add' || last === 'edit' || last === 'import'
}

/** Object detail pages (`/tenants/5`, `/devices/3`, …) keep their own tab
 * so following an object link never discards the page behind it. */
const DETAIL_SECTIONS = new Set([
	'tenants',
	'sites',
	'site-groups',
	'locations',
	'racks',
	'device-types',
	'manufacturers',
	'devices',
])

export function isDetailRoute(raw: string): boolean {
	const base = (raw.split('?')[0] ?? '').replace(/\/+$/, '') || '/'
	const segments = base.split('/').filter((p) => p.length > 0)
	return (
		segments.length === 2 &&
		DETAIL_SECTIONS.has(segments[0] ?? '') &&
		parseId(segments[1]) !== null
	)
}

/** Routes that open in a new tab: object details plus add/edit/import forms. */
export function isNewTabRoute(raw: string): boolean {
	return isOverlayRoute(raw) || isDetailRoute(raw)
}

/** Short human label for a tab button, derived from the route. */
export function tabTitle(raw: string): string {
	const base = (raw.split('?')[0] ?? '').replace(/\/+$/, '') || '/'
	const segments = base.split('/').filter((p) => p.length > 0)
	if (segments.length === 0) {
		return 'Tenants'
	}
	const names: Record<string, string> = {
		tenants: 'Tenants',
		sites: 'Sites',
		'site-groups': 'Site Groups',
		locations: 'Locations',
		racks: 'Racks',
		'rack-types': 'Rack Types',
		templates: 'Rack Types',
		'device-types': 'Device Types',
		manufacturers: 'Manufacturers',
		devices: 'Devices',
		interfaces: 'Interfaces',
		connections: 'Connections',
		cables: 'Connections',
		topology: 'Topology',
		users: 'Users',
	}
	const head = names[segments[0] ?? ''] ?? segments[0] ?? 'Page'
	if (segments[1] === 'add') {
		return `Add ${head.replace(/s$/, '')}`
	}
	if (segments[1] === 'import') {
		return `Import ${head}`
	}
	if (segments[1] !== undefined && segments[2] === 'edit') {
		return `Edit ${head.replace(/s$/, '')} ${segments[1]}`
	}
	if (segments[1] !== undefined) {
		return `${head.replace(/s$/, '')} ${segments[1]}`
	}
	return head
}

function findTabByPath(to: string): TabState | null {
	return tabs().find((t) => t.path === to) ?? null
}

function pushTab(to: string, openerId: number | null): TabState {
	const tab: TabState = { id: nextTabId++, path: to, openerId, gen: 0 }
	setTabs((prev) => [...prev, tab])
	setActiveTabId(tab.id)
	syncUrl(to)
	restoreScroll(tab.id)
	return tab
}

/** Switch to an existing tab, preserving every tab's mounted state. */
export function activateTab(id: number): void {
	const tab = tabs().find((t) => t.id === id)
	if (!tab || tab.id === activeTabId()) {
		if (tab) {
			syncUrl(tab.path)
		}
		return
	}
	rememberScroll(activeTabId())
	setActiveTabId(tab.id)
	syncUrl(tab.path)
	restoreScroll(tab.id)
}

/** Close a tab and focus its opener (or the nearest neighbor). */
export function closeTab(id: number): void {
	const list = tabs()
	const closing = list.find((t) => t.id === id)
	if (!closing) {
		return
	}
	if (list.length === 1) {
		return
	}
	rememberScroll(id)
	const remaining = list.filter((t) => t.id !== id)
	setTabs(remaining)
	scrollByTab.delete(id)
	if (activeTabId() === id) {
		const opener =
			closing.openerId !== null ? remaining.find((t) => t.id === closing.openerId) : undefined
		const index = list.findIndex((t) => t.id === id)
		const fallback = opener ?? remaining[Math.min(index, remaining.length - 1)] ?? remaining[0]
		if (fallback) {
			setActiveTabId(fallback.id)
			syncUrl(fallback.path)
			restoreScroll(fallback.id)
		}
	}
}

/**
 * Smart navigate:
 * - same path: no-op
 * - existing tab with `to`: activate it (no duplicate, state preserved)
 * - object/add/edit/import route: open a new tab, keeping the current page
 * - from a form tab to a list/detail route: close the form (dialog-like)
 *   and activate/refresh the target instead of morphing the form tab
 * - from an object tab elsewhere: open a new tab so the object is kept
 * - otherwise (list to list): update the active tab in place.
 */
export function navigate(to: string, opts?: NavigateOptions): void {
	const active = activeTab()
	if (!active) {
		pushTab(to, null)
		return
	}
	if (to === active.path) {
		syncUrl(to, opts?.replace)
		return
	}
	if (opts?.openInTab === true) {
		const existing = findTabByPath(to)
		if (existing) {
			activateTab(existing.id)
			return
		}
		rememberScroll(active.id)
		pushTab(to, active.id)
		return
	}
	const target = findTabByPath(to)
	const activeIsOverlay = isOverlayRoute(active.path)
	const activeIsLeaf = activeIsOverlay || isDetailRoute(active.path)
	const targetIsLeaf = isNewTabRoute(to)

	// Closing a form tab (save/cancel/back): never morph it into the target
	// and duplicate the opener — close it and show the target instead.
	if (activeIsOverlay && !isOverlayRoute(to)) {
		const refresh = opts?.refresh ?? true
		const openerId = active.openerId
		if (tabs().length === 1) {
			// Direct URL entry with no background tab: reuse the single tab.
			setTabs((prev) =>
				prev.map((t) =>
					t.id === active.id ? { ...t, path: to, gen: t.gen + (refresh ? 1 : 0) } : t,
				),
			)
			syncUrl(to, opts?.replace)
			return
		}
		// Drop the form tab first so `to` cannot match itself.
		const remaining = tabs().filter((t) => t.id !== active.id)
		scrollByTab.delete(active.id)
		if (target && target.id !== active.id) {
			const updated = refresh
				? remaining.map((t) => (t.id === target.id ? { ...t, gen: t.gen + 1 } : t))
				: remaining
			setTabs(updated)
			rememberScroll(active.id)
			setActiveTabId(target.id)
			syncUrl(to, opts?.replace)
			restoreScroll(target.id)
			return
		}
		// No tab shows the target yet: open it fresh and keep the opener
		// untouched so its list/detail state is preserved.
		setTabs(remaining)
		pushTab(to, openerId)
		return
	}

	if (target) {
		activateTab(target.id)
		if (opts?.refresh === true) {
			setTabs((prev) => prev.map((t) => (t.id === target.id ? { ...t, gen: t.gen + 1 } : t)))
		}
		return
	}

	// Object pages and forms keep their own tab; navigating away from an
	// object tab also opens a new tab so the object is never morphed away.
	if (targetIsLeaf || activeIsLeaf) {
		rememberScroll(active.id)
		pushTab(to, active.id)
		return
	}

	// List-to-list browsing reuses the active tab so the tab strip stays tidy.
	rememberScroll(active.id)
	setTabs((prev) => prev.map((t) => (t.id === active.id ? { ...t, path: to } : t)))
	syncUrl(to, opts?.replace)
	restoreScroll(active.id)
}

/** Explicit "open in new tab" for Ctrl/Cmd+click and nav "+" shortcuts. */
export function openInNewTab(to: string): void {
	navigate(to, { openInTab: true })
}

/**
 * Anchor helper honoring modifier keys: plain click follows the smart
 * rules, Ctrl/Cmd/Shift/middle-click forces a background-style new tab.
 */
export function goTo(e: MouseEvent, to: string): void {
	if (e.ctrlKey || e.metaKey || e.shiftKey || e.button === 1) {
		e.preventDefault()
		openInNewTab(to)
		return
	}
	e.preventDefault()
	navigate(to)
}

if (typeof window !== 'undefined') {
	window.addEventListener('popstate', () => {
		const url = window.location.pathname + window.location.search
		const active = activeTab()
		if (!active) {
			return
		}
		if (active.path !== url) {
			setTabs((prev) => prev.map((t) => (t.id === active.id ? { ...t, path: url } : t)))
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
