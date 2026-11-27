/**
 * Banner above every page while the session views the app as another role
 * (chosen in the account settings), with the way back to the own role.
 */
import { IconEye } from '@tabler/icons-solidjs'
import { Result } from 'better-result'
import { createSignal, type JSX } from 'solid-js'
import { setViewAs } from '../api/auth'
import { InlineError } from '../components/feedback'
import { t } from '../i18n'
import { updateSessionUser } from '../lib/session'

/** "Viewing as role …" notice with a button back to the own role. */
export function ViewAsBanner(props: { roleName: string }): JSX.Element {
	const [busy, setBusy] = createSignal(false)
	const [error, setError] = createSignal<string | null>(null)

	async function handleExit(): Promise<void> {
		setBusy(true)
		setError(null)
		const res = await setViewAs(null)
		setBusy(false)
		if (Result.isError(res)) {
			setError(res.error.message)
			return
		}
		updateSessionUser(res.value)
	}

	return (
		<div class="view-as-banner" role="status">
			<IconEye size={18} aria-hidden="true" />
			<span class="view-as-banner-text">{t('viewAs.banner', { role: props.roleName })}</span>
			<button type="button" disabled={busy()} onClick={() => void handleExit()}>
				{t('viewAs.exit')}
			</button>
			<InlineError message={error()} alert />
		</div>
	)
}
