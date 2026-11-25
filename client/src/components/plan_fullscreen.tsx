/**
 * Optional fullscreen view of a floor plan page (image and drawn plans):
 * hides the app's top bar, sidebar, breadcrumbs and footer so the plan
 * fills the window, and puts the browser into fullscreen where it allows.
 *
 * The whole document goes fullscreen, not the plan alone, so dialogs and
 * popovers rendered outside the page keep working. Leaving the browser's
 * fullscreen (Esc) leaves the view too; so does leaving the page.
 */
import { IconChevronLeft, IconMaximize } from '@tabler/icons-solidjs'
import { createSignal, type JSX, onCleanup, Show } from 'solid-js'
import { t } from '../i18n'

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

/**
 * Title of a plan page with the fullscreen switch before the heading: an
 * icon button enters the view, "Back" in its place leaves it.
 */
export function PlanFullscreenTitle(props: { children: JSX.Element }): JSX.Element {
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
		<div class="page-header-title plan-fullscreen-title">
			<Show
				when={active()}
				fallback={
					<button
						type="button"
						class="icon-btn"
						aria-label={t('floorplan.fullscreen')}
						title={t('floorplan.fullscreen')}
						onClick={enter}
					>
						<IconMaximize size={16} aria-hidden="true" />
					</button>
				}
			>
				<button type="button" class="plan-fullscreen-back" onClick={leave}>
					<IconChevronLeft size={16} aria-hidden="true" />
					{t('common.back')}
				</button>
			</Show>
			<h2>{props.children}</h2>
		</div>
	)
}
