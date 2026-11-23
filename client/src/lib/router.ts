/**
 * Browser-based navigation: exactly one page is shown, the one for the
 * current URL. Links use the normal browser history (pushState /
 * replaceState / popstate); "open in new tab" means a real browser tab.
 *
 * Each history entry carries `{ seq, key, from, scroll }` in `history.state`:
 * `seq` tells Back from Forward, `key` identifies the entry for paging and
 * scroll positions, `from` is the in-app path the entry was pushed from
 * (null for a direct URL or a reload), and `scroll` is the last scroll
 * position. Leaving a form (save or cancel) closes back into its opener when
 * the form was opened as a nested popup, and otherwise reuses the previous
 * history entry so Back never lands in a submitted form again.
 *
 * A route may end in an in-page anchor (`/sites/3#attachments`); it is part
 * of the path and ignored by route matching.
 */
import { createEffect, createSignal, onCleanup, untrack } from 'solid-js'
import { openItemsInNewTab } from './preferences'

export interface NavigateOptions {
	/** Force opening `to` in a new browser tab (e.g. Ctrl/Cmd+click). */
	newTab?: boolean
	/** Replace the current history entry instead of pushing one. */
	replace?: boolean
	/**
	 * Leaving a form without saving (cancel): return to the path this form
	 * was opened from, if any. `to` is only the fallback otherwise.
	 */
	back?: boolean
	/** Navigation (breadcrumbs, sidebar): never open an item in a new tab. */
	sameTab?: boolean
}

/** One breadcrumb link; the last crumb of a trail has no `href`. */
export interface Crumb {
	label: string
	href?: string
}

/** What a loaded page reports about itself for the document title and breadcrumbs. */
export interface PageMeta {
	/** Display name of the shown object. */
	name?: string
	/** Ancestors of the object, outermost first (e.g. site › location › rack). */
	crumbs?: readonly Crumb[]
}

interface HistoryState {
	seq: number
	key: string
	from: string | null
	scroll?: number
}

const DEFAULT_PATH = '/dashboard'

const [currentPath, setCurrentPath] = createSignal<string>(initialPath())

/** Scroll positions and paged-list state, keyed by history entry. */
const scrollByKey = new Map<string, number>()

let historySeq = 0
let currentKey = ''
let currentFrom: string | null = null
let keyCounter = 0

/** Set while the browser undoes a Back / Forward step a leave guard refused. */
let undoingStep = false

/** Set while a Back step the router started runs: its guards already passed. */
let routerBack = false

/** Cancels an in-progress scroll restore (the page remounts and loads async). */
let cancelScrollRestore: (() => void) | null = null

function currentUrl(): string {
	return window.location.pathname + window.location.search + window.location.hash
}

function initialPath(): string {
	if (typeof window === 'undefined') {
		return DEFAULT_PATH
	}
	return currentUrl() || DEFAULT_PATH
}

function newKey(): string {
	keyCounter += 1
	return `${Date.now()}-${keyCounter}`
}

function readState(state: unknown): HistoryState | null {
	if (typeof state !== 'object' || state === null) {
		return null
	}
	const raw = state as Record<string, unknown>
	if (typeof raw.seq !== 'number' || typeof raw.key !== 'string') {
		return null
	}
	return {
		seq: raw.seq,
		key: raw.key,
		from: typeof raw.from === 'string' ? raw.from : null,
		...(typeof raw.scroll === 'number' ? { scroll: raw.scroll } : {}),
	}
}

function stateFor(seq: number, key: string, from: string | null, scroll?: number): HistoryState {
	return scroll === undefined ? { seq, key, from } : { seq, key, from, scroll }
}

/** Guard for stored JSON that must be a list of strings. */
export function isStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((v) => typeof v === 'string')
}

/** Current route path: the URL shown by the one mounted page. */
export function path(): string {
	return currentPath()
}

/** A route without its query string and anchor. */
function barePath(raw: string): string {
	return raw.split(/[?#]/)[0] ?? ''
}

/** Path segments of a route, ignoring the query string, anchor and trailing slashes. */
export function routeSegments(raw: string): string[] {
	return barePath(raw)
		.split('/')
		.filter((p) => p.length > 0)
}

/** Last path segment is add/edit/import: the route is a form. */
function isFormRoute(raw: string): boolean {
	const last = routeSegments(raw).at(-1)
	return last === 'add' || last === 'edit' || last === 'import'
}

/** An item route is an object's detail page (its last segment is a positive id). */
function isItemRoute(raw: string): boolean {
	return parseId(routeSegments(raw).at(-1)) !== null
}

/** Whether a plain click on `to` should open a new browser tab. */
export function opensInNewTab(to: string): boolean {
	return openItemsInNewTab() && isItemRoute(to)
}

/** Metadata reported by loaded pages, keyed by route path. */
const [pageMeta, setPageMeta] = createSignal<Record<string, PageMeta>>({})

/** Metadata the page at `forPath` last reported, if it has loaded. */
export function pageMetaFor(forPath: string): PageMeta | undefined {
	return pageMeta()[forPath]
}

/**
 * Lets a page report its object's name and ancestors for the document title
 * and the breadcrumb bar. Kept after the page unmounts, so edit forms and
 * history entries can reuse it.
 */
export function usePageMeta(meta: () => PageMeta): void {
	const forPath = useRoutePath()
	createEffect(() => {
		const next = meta()
		const current = untrack(() => pageMeta()[forPath])
		if (JSON.stringify(current) === JSON.stringify(next)) {
			return
		}
		setPageMeta((all) => ({ ...all, [forPath]: next }))
	})
}

/**
 * Route path at component creation, for data fetching and metadata. Pages
 * remount whenever the path changes, so this stays stable for their lifetime.
 */
export function useRoutePath(): string {
	return untrack(path)
}

/** Saves the current scroll position in the map and in history.state. */
function rememberScroll(): void {
	const scroll = window.scrollY
	scrollByKey.set(currentKey, scroll)
	window.history.replaceState(stateFor(historySeq, currentKey, currentFrom, scroll), '', path())
}

/** Retry a scroll restore until the async-loaded page is tall enough (max ~2s). */
function restoreScroll(target: number): void {
	cancelScrollRestore?.()
	if (target <= 0) {
		window.scrollTo(0, 0)
		return
	}
	const started = performance.now()
	let frame = 0
	let stopped = false
	let detach = (): void => {}
	const stop = (): void => {
		if (stopped) {
			return
		}
		stopped = true
		cancelAnimationFrame(frame)
		detach()
		cancelScrollRestore = null
	}
	// Only user input cancels: plain `scroll` events also fire when the old
	// page unmounts and the browser clamps the position.
	const onUserInput = (): void => stop()
	const options: AddEventListenerOptions = { passive: true }
	const events = ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const
	for (const name of events) {
		window.addEventListener(name, onUserInput, options)
	}
	detach = (): void => {
		for (const name of events) {
			window.removeEventListener(name, onUserInput, options)
		}
	}
	cancelScrollRestore = stop
	const attempt = (): void => {
		if (stopped) {
			return
		}
		const maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight)
		if (maxScroll >= target || performance.now() - started >= 2000) {
			stop()
			window.scrollTo(0, target)
			return
		}
		frame = requestAnimationFrame(attempt)
	}
	frame = requestAnimationFrame(attempt)
}

/** Applies a history entry after a push/replace (top) or Back/Forward (restore). */
function enter(state: HistoryState, url: string, restore: boolean): void {
	historySeq = state.seq
	currentKey = state.key
	currentFrom = state.from
	setCurrentPath(url)
	if (restore) {
		restoreScroll(scrollByKey.get(state.key) ?? state.scroll ?? 0)
	} else {
		scrollByKey.set(state.key, 0)
		window.scrollTo(0, 0)
	}
}

/** Pushes `to` as a new entry, remembering where the user came from. */
function push(to: string): void {
	rememberScroll()
	const key = newKey()
	const state = stateFor(historySeq + 1, key, path())
	window.history.pushState(state, '', to)
	enter(state, to, false)
}

/** Replaces the current entry, keeping its key and opener path. */
function replace(to: string): void {
	rememberScroll()
	const state = stateFor(historySeq, currentKey, currentFrom)
	window.history.replaceState(state, '', to)
	enter(state, to, false)
}

/** Leaves a form without saving; returns to its opener when there is one. */
function leaveFormBack(to: string): void {
	rememberScroll()
	if (currentFrom !== null) {
		stepBack()
		return
	}
	replace(to)
}

/** Browser Back for a step whose leave guards the caller already checked. */
function stepBack(): void {
	routerBack = true
	window.history.back()
}

/**
 * A nested add form is a popup opened with an opener (see `SelectField`).
 * On save or cancel it closes instead of navigating; the opener refetches
 * its options when the dropdown opens again.
 */
function closeOpenerWindow(): boolean {
	if (window.opener !== null && window.history.length === 1) {
		window.close()
		return window.closed
	}
	return false
}

/**
 * Navigate:
 * - `newTab`: open `to` in a real browser tab
 * - form route being left (save/cancel): close a nested popup, step back to
 *   the opener when possible, else replace the form's entry
 * - otherwise: push (or replace) `to` in the browser history
 */
export function navigate(to: string, opts: NavigateOptions = {}): void {
	if (opts.newTab === true) {
		window.open(to, '_blank', 'noopener')
		return
	}
	const current = path()
	const leavingForm = isFormRoute(current)
	if (to === current && !leavingForm) {
		return
	}
	if (to !== current && leaveBlocked()) {
		return
	}
	if (leavingForm && closeOpenerWindow()) {
		return
	}
	if (opts.back === true) {
		leaveFormBack(to)
		return
	}
	if (leavingForm) {
		// Saving a form opened from `to` reuses that entry instead of adding
		// a duplicate list entry; any other target replaces the form entry.
		if (currentFrom === to) {
			leaveFormBack(to)
		} else {
			replace(to)
		}
		return
	}
	if (opts.replace === true) {
		replace(to)
	} else {
		push(to)
	}
}

/**
 * Click handler for in-app links. Modified clicks open a new browser tab; a
 * plain click on an item does so too when that preference is on, unless
 * `sameTab` (navigation links) is set.
 */
export function goTo(e: MouseEvent, to: string, opts?: NavigateOptions): void {
	e.preventDefault()
	const newTab =
		e.ctrlKey ||
		e.metaKey ||
		e.shiftKey ||
		e.button === 1 ||
		(opts?.sameTab !== true && opensInNewTab(to))
	navigate(to, { ...opts, newTab })
}

/**
 * Unsaved-work checks. A guard asks before its page is left and returns true
 * when the page must stay (the user declined to leave).
 */
interface LeaveGuard {
	isDirty: () => boolean
	message: () => string
}

const leaveGuards = new Set<LeaveGuard>()

/** True when a guard keeps the page: the user declined to leave. */
function leaveBlocked(): boolean {
	return [...leaveGuards].some((guard) => guard.isDirty() && !window.confirm(guard.message()))
}

/**
 * Asks with `message` before the calling page is left while `isDirty()`:
 * in-app navigation, Back / Forward, refreshing or closing the tab.
 */
export function useLeaveGuard(isDirty: () => boolean, message: () => string): void {
	const guard: LeaveGuard = { isDirty, message }
	leaveGuards.add(guard)
	onCleanup(() => leaveGuards.delete(guard))
}

if (typeof window !== 'undefined') {
	if ('scrollRestoration' in window.history) {
		window.history.scrollRestoration = 'manual'
	}
	const initial = readState(window.history.state)
	if (initial === null) {
		historySeq = 0
		currentKey = newKey()
		currentFrom = null
		window.history.replaceState(stateFor(historySeq, currentKey, currentFrom), '', currentUrl())
	} else {
		historySeq = initial.seq
		currentKey = initial.key
		currentFrom = initial.from
		if (initial.scroll !== undefined) {
			scrollByKey.set(currentKey, initial.scroll)
		}
	}
	setCurrentPath(currentUrl())

	window.addEventListener('popstate', (e: PopStateEvent) => {
		const next = readState(e.state)
		// Entries without a seq are in-page `#anchor` jumps: leave them alone.
		if (next === null) {
			return
		}
		const step = next.seq - historySeq
		historySeq = next.seq
		if (undoingStep) {
			undoingStep = false
			return
		}
		const url = currentUrl()
		const checked = routerBack
		routerBack = false
		if (!checked && url !== path() && leaveBlocked()) {
			// Undo the browser's step; the popstate that fires keeps the page.
			undoingStep = true
			window.history.go(-step)
			return
		}
		enter(next, url, true)
	})

	window.addEventListener('beforeunload', (e: BeforeUnloadEvent) => {
		if ([...leaveGuards].some((guard) => guard.isDirty())) {
			e.preventDefault()
			e.returnValue = ''
		}
	})
}

/** The route shows the object at `objectPath` or one of its sub-pages. */
function showsObject(route: string, objectPath: string): boolean {
	const bare = barePath(route)
	return bare === objectPath || bare.startsWith(`${objectPath}/`)
}

/**
 * After the object at `objectPath` (e.g. `/devices/12`) was deleted: step
 * back to the entry it was opened from when that does not show the object,
 * else replace the current entry with the list at `listRoute`.
 */
export function forgetDeleted(objectPath: string, listRoute: string): void {
	rememberScroll()
	if (currentFrom !== null && !showsObject(currentFrom, objectPath)) {
		stepBack()
		return
	}
	replace(listRoute)
}

/**
 * Identifies the history entry a page mounts into, so it can pick up where it
 * left off when the user comes back; null when `forPath` is not shown.
 */
export function historyEntryKey(forPath: string): string | null {
	return forPath === path() ? `${currentKey}:${forPath}` : null
}

/** Path the form's history entry was opened from, or null for a direct entry. */
export function useOpenerPath(): () => string | null {
	return () => currentFrom
}

/**
 * Where an add/edit form goes on save and cancel: the entity's list for add
 * (`id` omitted), and for edit the opener when it shows that list, else the
 * detail page. `listRoute` is the list path, e.g. `/device-roles`;
 * `detailBase` the detail path prefix when it differs (`/devices/vm`).
 */
export function useFormReturnRoute(
	listRoute: string,
	id?: number,
	detailBase: string = listRoute,
): () => string {
	const openerPath = useOpenerPath()
	return () => {
		if (id === undefined) {
			return listRoute
		}
		const opener = openerPath()
		return opener !== null &&
			routeSegments(opener).join('/') === routeSegments(listRoute).join('/')
			? opener
			: `${detailBase}/${id}`
	}
}

/** Reads one query param from the current route (e.g. `?tenant=<id>`). */
export function queryParam(key: string, fromPath?: string): string {
	const current = (fromPath ?? useRoutePath()).split('#')[0] ?? ''
	const query = current.includes('?') ? (current.split('?')[1] ?? '') : ''
	return new URLSearchParams(query).get(key) ?? ''
}

/** `?face=` of a rack-elevation deep link, if it names a face. */
export function queryFace(): string {
	const face = queryParam('face')
	return face === 'front' || face === 'rear' ? face : ''
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
