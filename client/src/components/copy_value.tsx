import { IconCheck, IconCopy } from '@tabler/icons-solidjs'
import { Result } from 'better-result'
import { createSignal, type JSX, onCleanup } from 'solid-js'
import { t } from '../i18n'

/** How long the check mark replaces the copy icon after a copy. */
const COPIED_MS = 1500

/**
 * `children` (a mail or phone link) with a small copy button for `value` that
 * shows on hover or keyboard focus. A check mark confirms the copy.
 */
export function CopyValue(props: { value: string; children: JSX.Element }): JSX.Element {
	const [copied, setCopied] = createSignal(false)
	let timer: ReturnType<typeof setTimeout> | undefined
	onCleanup(() => clearTimeout(timer))

	async function copy(event: MouseEvent): Promise<void> {
		// Inside clickable rows the click must not open the row.
		event.stopPropagation()
		const res = await Result.tryPromise({
			try: () => navigator.clipboard.writeText(props.value),
			catch: () => new Error('clipboard unavailable'),
		})
		// Without clipboard access (no HTTPS) the button just shows no check mark.
		if (Result.isError(res)) {
			return
		}
		setCopied(true)
		clearTimeout(timer)
		timer = setTimeout(() => setCopied(false), COPIED_MS)
	}

	return (
		<span class="copy-value">
			{props.children}
			<button
				type="button"
				class="copy-value-btn"
				classList={{ 'copy-value-done': copied() }}
				title={copied() ? t('common.copied') : t('common.copy')}
				aria-label={t('common.copyValue', { value: props.value })}
				onClick={(event: MouseEvent) => void copy(event)}
			>
				{copied() ? (
					<IconCheck size={14} aria-hidden="true" />
				) : (
					<IconCopy size={14} aria-hidden="true" />
				)}
			</button>
		</span>
	)
}
