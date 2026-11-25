/**
 * Optional fullscreen view of a floor plan page (image and drawn plans):
 * hides the app's top bar, sidebar, breadcrumbs and footer so the plan
 * fills the window, and puts the browser into fullscreen where it allows.
 *
 * The whole document goes fullscreen, not the plan alone, so dialogs and
 * popovers rendered outside the page keep working. Leaving the browser's
 * fullscreen (Esc) leaves the view too; so does leaving the page.
 */
import { IconMaximize, IconMinimize } from '@tabler/icons-solidjs'
import { createSignal, type JSX, onCleanup } from 'solid-js'
import { t } from '../i18n'
import { IconLabel } from './icon_label'

const ROOT_CLASS = 'plan-fullscreen'

const [active, setActive] = createSignal(false)

function apply(on: boolean): void {
	setActive(on)
	document.documentElement.classList.toggle(ROOT_CLASS, on)
}

function enter(): void {
	apply(true)
	const root = document.documentElement
	if (!document.fullscreenElement && typeof root.requestFullscreen === 'function') {
		// Refused (no permission, iframe): the in-page view still applies.
		root.requestFullscreen().catch(() => undefined)
	}
}

function leave(): void {
	apply(false)
	if (document.fullscreenElement) {
		document.exitFullscreen().catch(() => undefined)
	}
}

/** Header button that switches the page's fullscreen view on and off. */
export function PlanFullscreenButton(): JSX.Element {
	const onChange = (): void => {
		if (!document.fullscreenElement && active()) {
			apply(false)
		}
	}
	document.addEventListener('fullscreenchange', onChange)
	onCleanup(() => {
		document.removeEventListener('fullscreenchange', onChange)
		if (active()) {
			leave()
		}
	})
	return (
		<button
			type="button"
			aria-pressed={active()}
			onClick={() => (active() ? leave() : enter())}
		>
			<IconLabel icon={active() ? IconMinimize : IconMaximize}>
				{t(active() ? 'floorplan.exitFullscreen' : 'floorplan.fullscreen')}
			</IconLabel>
		</button>
	)
}
