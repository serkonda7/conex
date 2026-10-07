/** Outside-press dismissal for menus, dropdowns and popovers. */
import { onCleanup, onMount } from 'solid-js'

/**
 * Calls `close` when a pointer press lands outside `inside`: a selector
 * matched against the target's ancestors, or the popover's root element.
 */
export function useDismiss(inside: string | (() => Element | undefined), close: () => void): void {
	onMount(() => {
		const onPointerDown = (e: PointerEvent): void => {
			const target = e.target
			if (!(target instanceof Element)) {
				return
			}
			const within =
				typeof inside === 'string'
					? target.closest(inside) !== null
					: inside()?.contains(target) === true
			if (!within) {
				close()
			}
		}
		document.addEventListener('pointerdown', onPointerDown)
		onCleanup(() => document.removeEventListener('pointerdown', onPointerDown))
	})
}
