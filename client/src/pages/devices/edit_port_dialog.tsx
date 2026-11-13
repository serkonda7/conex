import { IconLinkPlus, IconUnlink } from '@tabler/icons-solidjs'
import type { TraceEndToEnd, TraceLink } from 'shared/src/types'
import type { JSX } from 'solid-js'
import { createSignal, Show } from 'solid-js'
import { delete_cable } from '../../api/cables'
import { type InterfaceJson, update_interface } from '../../api/devices'
import { InlineError } from '../../components/feedback'
import { TextField, ToggleField } from '../../components/form'
import { confirmDiscard, Modal } from '../../components/modal'
import { t } from '../../i18n'
import { useAction } from '../../lib/resource'
import { ConnectPortDialog } from './connect_port_dialog'
import { PortPeer } from './trace_peer'

export interface EditPortDialogProps {
	device_id: number
	iface: InterfaceJson
	/** Show the enabled toggle (network ports only). */
	show_enabled: boolean
	/** Current cable of the port; it can be connected or removed from the dialog. */
	link: TraceLink | undefined
	endToEnd: TraceEndToEnd[]
	on_saved: () => void
	on_close: () => void
}

/**
 * Port edit dialog: rename, (for network ports) enable/disable, and connect
 * or remove the cable. Cables are changed right away; the dialog stays open.
 */
export function EditPortDialog(props: EditPortDialogProps): JSX.Element {
	const [name, setName] = createSignal(props.iface.name)
	const [enabled, setEnabled] = createSignal(props.iface.enabled)
	const [connecting, setConnecting] = createSignal(false)
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
		<>
			<Modal
				title={t('device.editPort', { name: props.iface.name })}
				dirty={dirty()}
				on_close={props.on_close}
			>
				<form class="form-stacked" onSubmit={handleSave}>
					<Show when={props.show_enabled}>
						<ToggleField
							id="edit-port-enabled"
							label={t('common.status')}
							checked={enabled()}
							onChange={setEnabled}
							on_text={t('device.enabled')}
							off_text={t('device.disabled')}
						/>
					</Show>
					<TextField
						id="edit-port-name"
						label={t('common.name')}
						value={name()}
						onInput={setName}
						required
						autofocus
					/>
					<div class="field">
						<span class="field-group-label">{t('device.connection')}</span>
						<div class="field-control">
							<span class="panel-port-cell">
								<PortPeer link={props.link} endToEnd={props.endToEnd} />
								<Show
									when={props.link}
									fallback={
										<Show when={!props.iface.connected}>
											<button
												type="button"
												class="icon-btn icon-btn-connect"
												title={t('device.connectToPeer', {
													name: props.iface.name,
												})}
												aria-label={t('device.connectCableFor', {
													name: props.iface.name,
												})}
												onClick={(): void => {
													setError(null)
													setConnecting(true)
												}}
											>
												<IconLinkPlus size={20} />
											</button>
										</Show>
									}
								>
									{(link: () => TraceLink): JSX.Element => (
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
											onClick={(): void =>
												void handleDisconnect(link().cable_id)
											}
										>
											<IconUnlink size={20} />
										</button>
									)}
								</Show>
							</span>
						</div>
					</div>
					<div class="modal-actions">
						<button type="submit" disabled={!name().trim() || save.pending()}>
							{t('common.save')}
						</button>
						<button
							type="button"
							onClick={() => confirmDiscard(dirty()) && props.on_close()}
						>
							{t('common.cancel')}
						</button>
					</div>
				</form>
				<InlineError message={error()} alert />
			</Modal>
			<Show when={connecting()}>
				<ConnectPortDialog
					iface={props.iface}
					on_connected={() => setConnecting(false)}
					on_close={() => setConnecting(false)}
				/>
			</Show>
		</>
	)
}
