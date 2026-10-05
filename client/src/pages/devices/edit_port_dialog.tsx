import { Result } from 'better-result'
import type { JSX } from 'solid-js'
import { createSignal, Show } from 'solid-js'
import { type InterfaceJson, update_interface } from '../../api/devices'
import { InlineError } from '../../components/feedback'
import { CheckboxField, TextField } from '../../components/form'
import { Modal } from '../../components/modal'
import { t } from '../../i18n'

export interface EditPortDialogProps {
	device_id: number
	iface: InterfaceJson
	/** Show the enabled toggle (network ports only). */
	show_enabled: boolean
	on_saved: () => void
	on_close: () => void
}

/** Port edit dialog: rename and (for network ports) enable/disable. */
export function EditPortDialog(props: EditPortDialogProps): JSX.Element {
	const [name, setName] = createSignal(props.iface.name)
	const [enabled, setEnabled] = createSignal(props.iface.enabled)
	const [error, setError] = createSignal<string | null>(null)
	const [submitting, setSubmitting] = createSignal(false)

	async function handleSave(e: SubmitEvent): Promise<void> {
		e.preventDefault()
		const trimmed = name().trim()
		if (!trimmed) {
			return
		}
		const input = {
			...(trimmed !== props.iface.name ? { name: trimmed } : {}),
			...(props.show_enabled && enabled() !== props.iface.enabled
				? { enabled: enabled() }
				: {}),
		}
		if (Object.keys(input).length === 0) {
			props.on_close()
			return
		}
		setError(null)
		setSubmitting(true)
		const res = await update_interface(props.device_id, props.iface.id, input)
		setSubmitting(false)
		if (Result.isError(res)) {
			setError(res.error.message)
			return
		}
		props.on_saved()
	}

	return (
		<Modal title={t('device.editPort', { name: props.iface.name })} on_close={props.on_close}>
			<form class="form-stacked" onSubmit={handleSave}>
				<TextField
					id="edit-port-name"
					label={t('common.name')}
					value={name()}
					onInput={setName}
					required
					autofocus
				/>
				<Show when={props.show_enabled}>
					<CheckboxField
						id="edit-port-enabled"
						label={t('device.enabled')}
						checked={enabled()}
						onChange={setEnabled}
					/>
				</Show>
				<div class="modal-actions">
					<button type="submit" disabled={!name().trim() || submitting()}>
						{t('common.save')}
					</button>
					<button type="button" onClick={props.on_close}>
						{t('common.cancel')}
					</button>
				</div>
			</form>
			<InlineError message={error()} alert />
		</Modal>
	)
}
