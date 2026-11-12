import { IconUnlink } from '@tabler/icons-solidjs'
import type { TraceEndToEnd, TraceLink } from 'shared/src/types'
import type { JSX } from 'solid-js'
import { createSignal, Show } from 'solid-js'
import { delete_cable } from '../../api/cables'
import { type InterfaceJson, update_interface } from '../../api/devices'
import { InlineError } from '../../components/feedback'
import { CheckboxField, TextField } from '../../components/form'
import { confirmDiscard, Modal } from '../../components/modal'
import { t } from '../../i18n'
import { useAction } from '../../lib/resource'
import { PortPeer } from './trace_peer'

export interface EditPortDialogProps {
	device_id: number
	iface: InterfaceJson
	/** Show the enabled toggle (network ports only). */
	show_enabled: boolean
	/** Current cable of the port; it can be removed from the dialog. */
	link: TraceLink | undefined
	endToEnd: TraceEndToEnd[]
	on_saved: () => void
	on_close: () => void
}

/**
 * Port edit dialog: rename, (for network ports) enable/disable, and remove
 * the cable. The cable is removed right away; the dialog stays open.
 */
export function EditPortDialog(props: EditPortDialogProps): JSX.Element {
	const [name, setName] = createSignal(props.iface.name)
	const [enabled, setEnabled] = createSignal(props.iface.enabled)
	const [error, setError] = createSignal<string | null>(null)
	const save = useAction(setError)
	const cable = useAction(setError)
	const dirty = (): boolean =>
		name().trim() !== props.iface.name ||
		(props.show_enabled && enabled() !== props.iface.enabled)

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
		if (await save.run(() => update_interface(props.device_id, props.iface.id, input))) {
			props.on_saved()
		}
	}

	async function handleDisconnect(cableId: number): Promise<void> {
		await cable.run(() => delete_cable(cableId))
	}

	return (
		<Modal
			title={t('device.editPort', { name: props.iface.name })}
			dirty={dirty()}
			on_close={props.on_close}
		>
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
				<Show when={props.link}>
					{(link: () => TraceLink): JSX.Element => (
						<div class="field">
							<span class="field-group-label">{t('device.connection')}</span>
							<div class="field-control">
								<span class="panel-port-cell">
									<PortPeer link={link()} endToEnd={props.endToEnd} />
									<button
										type="button"
										class="icon-btn icon-btn-danger"
										disabled={cable.pending()}
										title={t('device.disconnectPort', {
											name: props.iface.name,
										})}
										aria-label={t('device.disconnectPort', {
											name: props.iface.name,
										})}
										onClick={(): void => void handleDisconnect(link().cable_id)}
									>
										<IconUnlink size={20} />
									</button>
								</span>
							</div>
						</div>
					)}
				</Show>
				<div class="modal-actions">
					<button
						type="button"
						onClick={() => confirmDiscard(dirty()) && props.on_close()}
					>
						{t('common.cancel')}
					</button>
					<button type="submit" disabled={!name().trim() || save.pending()}>
						{t('common.save')}
					</button>
				</div>
			</form>
			<InlineError message={error()} alert />
		</Modal>
	)
}
