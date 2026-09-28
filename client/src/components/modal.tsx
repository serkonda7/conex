import type { JSX } from 'solid-js'
import { t } from '../i18n'

export interface ModalProps {
	title: string
	/** Extra class on the dialog box, e.g. to widen it. */
	class?: string
	on_close: () => void
	children: JSX.Element
}

/** Modal dialog shell: backdrop, titled box and close button. */
export function Modal(props: ModalProps): JSX.Element {
	return (
		<div class="modal-wrap" role="presentation">
			<button
				type="button"
				class="modal-backdrop"
				aria-label={t('common.close')}
				onClick={props.on_close}
			/>
			<section
				class={props.class ? `modal ${props.class}` : 'modal'}
				role="dialog"
				aria-modal="true"
				aria-label={props.title}
			>
				<div class="modal-header">
					<h3>{props.title}</h3>
					<button
						type="button"
						class="icon-btn"
						aria-label={t('common.close')}
						onClick={props.on_close}
					>
						×
					</button>
				</div>
				{props.children}
			</section>
		</div>
	)
}
