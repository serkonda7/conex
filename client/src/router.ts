/** Minimal history-based routing for the few app pages. */
import { createSignal } from 'solid-js'

const [path, setPath] = createSignal(window.location.pathname)

/** Set when tags are created or deleted so the home view can refresh entries. */
const [tagsChanged, setTagsChanged] = createSignal(false)

window.addEventListener('popstate', () => {
	setPath(window.location.pathname + window.location.search)
})

export function navigate(to: string): void {
	if (to === path()) {
		return
	}
	window.history.pushState(null, '', to)
	setPath(to)
}

/** Reads one query param from the current route (e.g. `?tenant=<id>`). */
export function queryParam(key: string): string {
	const current = path()
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

export { path, setTagsChanged, tagsChanged }
