import { Modal as BaseModal } from '@serkonda7/solid-components'
import type { JSX } from 'solid-js'
import { t } from '../i18n'

export interface ModalProps {
	title: string
	/** Extra class on the dialog box, e.g. to widen it. */
	class?: string
	/** Unsaved changes: Escape, a backdrop click and the close button ask first. */
	dirty?: boolean
	on_close: () => void
	children: JSX.Element
}

/** True when the dialog may close: nothing is unsaved, or the user discards it. */
export function confirmDiscard(dirty: boolean | undefined): boolean {
	return !dirty || window.confirm(t('common.confirmDiscard'))
}

/**
 * The solid-components `Modal`, open while mounted and with its close label
 * localized. Pages import it from here instead of the package.
 */
export function Modal(props: ModalProps): JSX.Element {
	return (
		<BaseModal
			open
			title={props.title}
			class={props.class}
			onBeforeClose={() => confirmDiscard(props.dirty)}
			onClose={props.on_close}
			closeLabel={t('common.close')}
		>
			{props.children}
		</BaseModal>
	)
}
