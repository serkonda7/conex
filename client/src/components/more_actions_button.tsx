/**
 * The "more actions" trigger shared by row actions and the detail header.
 *
 * Three horizontal dots (`⋯`) on purpose: that is the desktop table
 * convention for per-row overflow (Gmail, GitHub, Linear) and reads as
 * "this row's actions continue". The vertical stack (`⋮`) is Material's
 * app-level overflow glyph, a wider scope than a single row's menu.
 *
 * The component owns its `.row-menu-wrap` so `useDismiss` treats the toggle
 * as part of the menu it opened.
 */
import { IconDots } from '@tabler/icons-solidjs'
import type { JSX } from 'solid-js'
import { t } from '../i18n'

/** Square icon chip that opens a `RowMenu` anchored to it. */
export function MoreActionsButton(props: {
	/** Row or record name the menu acts on, used in the accessible label. */
	name: string
	/** Whether the menu this button owns is currently open. */
	open: boolean
	onToggle: (e: MouseEvent & { currentTarget: HTMLButtonElement }) => void
	onClose: () => void
}): JSX.Element {
	return (
		<div class="row-menu-wrap">
			<button
				type="button"
				class="icon-btn"
				aria-label={t('common.moreActionsFor', { name: props.name })}
				aria-haspopup="menu"
				aria-expanded={props.open}
				onClick={props.onToggle}
				onKeyDown={(e: KeyboardEvent): void => {
					if (e.key === 'Escape') {
						props.onClose()
					}
				}}
			>
				<IconDots size={16} />
			</button>
		</div>
	)
}
