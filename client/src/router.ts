/** Minimal history-based routing for the few app pages. */
import { createSignal } from 'solid-js'

const [path, setPath] = createSignal(window.location.pathname)

/** Set when tags are created or deleted so the home view can refresh entries. */
const [tagsChanged, setTagsChanged] = createSignal(false)

window.addEventListener('popstate', () => {
	setPath(window.location.pathname)
})

export function navigate(to: string): void {
	if (to === path()) {
		return
	}
	window.history.pushState(null, '', to)
	setPath(to)
}

export { path, setTagsChanged, tagsChanged }
