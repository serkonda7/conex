import type { JSX } from 'solid-js'

/**
 * Link to another spot on the current page (decision 0001). Scrolls within its
 * own tab pane: open tabs stay mounted, so a browser hash jump could pick a
 * hidden tab's duplicate id. Modified clicks stay with the browser.
 */
export function ScrollLink(props: {
	/** Id of the element to scroll to. */
	target: string
	class?: string
	/** Runs before scrolling, e.g. to open the tab holding the target. */
	onFollow?: () => void
	children: JSX.Element
}): JSX.Element {
	function onClick(e: MouseEvent & { currentTarget: HTMLAnchorElement }): void {
		if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) {
			return
		}
		e.preventDefault()
		props.onFollow?.()
		e.currentTarget
			.closest('.tab-pane')
			?.querySelector(`#${CSS.escape(props.target)}`)
			?.scrollIntoView({ block: 'start' })
	}
	return (
		<a class={props.class} href={`#${props.target}`} onClick={onClick}>
			{props.children} <span aria-hidden="true">↓</span>
		</a>
	)
}
