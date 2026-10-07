import { Result } from 'better-result'
import { createSignal, type JSX, Show } from 'solid-js'
import { change_password } from '../api/auth'
import { InlineError } from '../components/feedback'
import { TextField } from '../components/form'
import { Modal } from '../components/modal'
import { t } from '../i18n'

/** Self-service password change, opened from the account menu. */
export function PasswordDialog(props: { on_close: () => void }): JSX.Element {
	const [current, setCurrent] = createSignal('')
	const [next, setNext] = createSignal('')
	const [confirm, setConfirm] = createSignal('')
	const [error, setError] = createSignal<string | null>(null)
	const [submitting, setSubmitting] = createSignal(false)
	const [done, setDone] = createSignal(false)

	async function handleSave(e: SubmitEvent): Promise<void> {
		e.preventDefault()
		if (next() !== confirm()) {
			setError(t('auth.passwordMismatch'))
			return
		}
		setError(null)
		setSubmitting(true)
		const res = await change_password(current(), next())
		setSubmitting(false)
		if (Result.isError(res)) {
			setError(res.error.message)
			return
		}
		setDone(true)
	}

	return (
		<Modal title={t('account.changePassword')} on_close={props.on_close}>
			<Show
				when={!done()}
				fallback={
					<div class="form-stacked">
						<p role="status">{t('account.passwordChanged')}</p>
						<div class="modal-actions">
							<button type="button" onClick={props.on_close}>
								{t('common.close')}
							</button>
						</div>
					</div>
				}
			>
				<form class="form-stacked" onSubmit={handleSave}>
					<TextField
						id="account-current-password"
						label={t('account.currentPassword')}
						type="password"
						value={current()}
						onInput={setCurrent}
						autocomplete="current-password"
						required
						autofocus
					/>
					<TextField
						id="account-new-password"
						label={t('user.newPassword')}
						type="password"
						value={next()}
						onInput={setNext}
						autocomplete="new-password"
						required
					/>
					<TextField
						id="account-confirm-password"
						label={t('auth.confirmPassword')}
						type="password"
						value={confirm()}
						onInput={setConfirm}
						autocomplete="new-password"
						required
					/>
					<div class="modal-actions">
						<button
							type="submit"
							disabled={!current() || !next() || !confirm() || submitting()}
						>
							{t('common.save')}
						</button>
						<button type="button" onClick={props.on_close}>
							{t('common.cancel')}
						</button>
					</div>
				</form>
				<InlineError message={error()} alert />
			</Show>
		</Modal>
	)
}
