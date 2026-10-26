import { IconLinkPlus, IconUnlink } from '@tabler/icons-solidjs'
import type { InterfaceUpdate, TraceEndToEnd, TraceLink } from 'shared/src/types'
import type { JSX } from 'solid-js'
import { createSignal, Show } from 'solid-js'
import { delete_cable } from '../../api/cables'
import { type InterfaceJson, update_interface } from '../../api/devices'
import { InlineError } from '../../components/feedback'
import { CheckboxField, type FormOption, FormSection, TextField } from '../../components/form'
import { Modal } from '../../components/modal'
import { t } from '../../i18n'
import { useAction } from '../../lib/resource'
import { parseId } from '../../lib/router'
import { ConnectPortDialog } from './connect_port_dialog'
import { isOutlet, OutletLocationField } from './outlet_location'
import { PortPeer } from './trace_peer'

export interface PanelRowDialogProps {
	device_id: number
	/** Rear port of the row; null on a position row of a multi-position rear port. */
	rear: InterfaceJson | null
	/** Front port of the row, if one is mapped there. */
	front: InterfaceJson | null
	links: Map<number, TraceLink>
	endToEnd: (ifaceId: number) => TraceEndToEnd[]
	/** Location choices of an outlet (`useOutletLocationOptions`). */
	location_options: FormOption[]
	/** A cable was connected or removed; the dialog stays open. */
	on_changed: () => void
	on_saved: () => void
	on_close: () => void
}

/**
 * Edit dialog of one patch-panel row: whether it is patched, names and
 * cables of its front and rear port, and (for an outlet) the rear port's
 * location. Cables are connected and removed right away; the other fields
 * are saved together (`patched` on both ports of the row).
 */
export function PanelRowDialog(props: PanelRowDialogProps): JSX.Element {
	const [frontName, setFrontName] = createSignal(props.front?.name ?? '')
	const [rearName, setRearName] = createSignal(props.rear?.name ?? '')
	const [location, setLocation] = createSignal(String(props.rear?.location_id ?? ''))
	const [patched, setPatched] = createSignal((props.rear ?? props.front)?.patched ?? true)
	const [connecting, setConnecting] = createSignal<InterfaceJson | null>(null)
	const [error, setError] = createSignal<string | null>(null)
	const save = useAction(setError)
	const cable = useAction(setError)

	const title = (): string =>
		t('device.panel.editRow', {
			name: [props.front?.name, props.rear?.name].filter(Boolean).join(' / '),
		})
	/** Cabled ports must stay patched; disconnect them first. */
	const cabled = (): boolean => Boolean(props.front?.connected || props.rear?.connected)
	const valid = (): boolean =>
		(!props.front || frontName().trim() !== '') && (!props.rear || rearName().trim() !== '')

	/** Changed fields of a port; empty when nothing changed. */
	function changesOf(iface: InterfaceJson, name: string): InterfaceUpdate {
		const locationId = parseId(location())
		return {
			...(name.trim() !== iface.name ? { name: name.trim() } : {}),
			...(isOutlet(iface) && locationId !== iface.location_id
				? { location_id: locationId }
				: {}),
			...(patched() !== iface.patched ? { patched: patched() } : {}),
		}
	}

	async function handleSave(e: SubmitEvent): Promise<void> {
		e.preventDefault()
		if (!valid()) {
			return
		}
		const updates = [
			{ iface: props.front, name: frontName() },
			{ iface: props.rear, name: rearName() },
		].flatMap(({ iface, name }) => {
			const input = iface ? changesOf(iface, name) : {}
			return iface && Object.keys(input).length > 0 ? [{ iface, input }] : []
		})
		for (const { iface, input } of updates) {
			if (!(await save.run(() => update_interface(props.device_id, iface.id, input)))) {
				// Earlier updates may have gone through; show them behind the dialog.
				props.on_changed()
				return
			}
		}
		if (updates.length === 0) {
			props.on_close()
			return
		}
		props.on_saved()
	}

	async function handleDisconnect(cableId: number): Promise<void> {
		if (await cable.run(() => delete_cable(cableId))) {
			props.on_changed()
		}
	}

	/** Current cable of a port with its connect or disconnect button. */
	const connectionField = (iface: InterfaceJson): JSX.Element => (
		<div class="field">
			<span class="field-group-label">{t('device.connection')}</span>
			<div class="field-control">
				<span class="panel-port-cell">
					<PortPeer
						link={props.links.get(iface.id)}
						endToEnd={props.endToEnd(iface.id)}
					/>
					<Show
						when={props.links.get(iface.id)}
						fallback={
							<button
								type="button"
								class="icon-btn icon-btn-connect"
								disabled={iface.connected || !iface.patched || !patched()}
								title={
									iface.patched && patched()
										? t('device.connectToPeer', { name: iface.name })
										: t('device.panel.notPatchedConnect')
								}
								aria-label={t('device.connectCableFor', { name: iface.name })}
								onClick={(): void => {
									setError(null)
									setConnecting(iface)
								}}
							>
								<IconLinkPlus size={20} />
							</button>
						}
					>
						{(link: () => TraceLink): JSX.Element => (
							<button
								type="button"
								class="icon-btn icon-btn-danger"
								disabled={cable.pending()}
								title={t('device.disconnectPort', { name: iface.name })}
								aria-label={t('device.disconnectPort', { name: iface.name })}
								onClick={(): void => void handleDisconnect(link().cable_id)}
							>
								<IconUnlink size={20} />
							</button>
						)}
					</Show>
				</span>
			</div>
		</div>
	)

	return (
		<>
			<Modal title={title()} on_close={props.on_close}>
				<form class="form-stacked" onSubmit={handleSave}>
					<Show when={props.front || props.rear}>
						<CheckboxField
							id="panel-row-patched"
							label={t('device.panel.patched')}
							checked={patched()}
							onChange={setPatched}
							disabled={cabled() && patched()}
							title={
								cabled() && patched() ? t('device.panel.cabledPatched') : undefined
							}
						/>
					</Show>
					<Show when={props.front}>
						{(front: () => InterfaceJson): JSX.Element => (
							<FormSection title={t('device.panel.frontPort')}>
								<TextField
									id="panel-row-front-name"
									label={t('common.name')}
									value={frontName()}
									onInput={setFrontName}
									required
									autofocus
								/>
								{connectionField(front())}
							</FormSection>
						)}
					</Show>
					<Show when={props.rear}>
						{(rear: () => InterfaceJson): JSX.Element => (
							<FormSection title={t('device.panel.rearPort')}>
								<TextField
									id="panel-row-rear-name"
									label={t('common.name')}
									value={rearName()}
									onInput={setRearName}
									required
									autofocus={!props.front}
								/>
								{connectionField(rear())}
								<Show when={isOutlet(rear())}>
									<OutletLocationField
										id="panel-row-location"
										value={location()}
										onChange={setLocation}
										options={props.location_options}
									/>
								</Show>
							</FormSection>
						)}
					</Show>
					<div class="modal-actions">
						<button type="submit" disabled={!valid() || save.pending()}>
							{t('common.save')}
						</button>
						<button type="button" onClick={props.on_close}>
							{t('common.cancel')}
						</button>
					</div>
				</form>
				<InlineError message={error()} alert />
			</Modal>
			<Show when={connecting()}>
				{(iface: () => InterfaceJson): JSX.Element => (
					<ConnectPortDialog
						iface={iface()}
						on_connected={() => {
							setConnecting(null)
							props.on_changed()
						}}
						on_close={() => setConnecting(null)}
					/>
				)}
			</Show>
		</>
	)
}
