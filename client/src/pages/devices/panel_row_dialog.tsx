import { IconLinkPlus, IconLock, IconUnlink } from '@tabler/icons-solidjs'
import type { InterfaceUpdate, TraceEndToEnd, TraceLink } from 'shared/src/types'
import type { JSX } from 'solid-js'
import { createSignal, Show } from 'solid-js'
import type { FloorplanOutletJson } from '../../api/attachments'
import { delete_cable } from '../../api/cables'
import { type InterfaceJson, update_interface } from '../../api/devices'
import { InlineError } from '../../components/feedback'
import { type FormOption, Hint, SelectField, useAutofocus } from '../../components/form'
import { confirmDiscard, Modal } from '../../components/modal'
import { t } from '../../i18n'
import { floorplanHref } from '../../lib/floorplan_link'
import { useAction } from '../../lib/resource'
import { parseId } from '../../lib/router'
import { ConnectPortDialog } from './connect_port_dialog'
import { isOutlet } from './outlet'
import { PortPeer } from './trace_peer'

export interface PanelRowDialogProps {
	device_id: number
	/** Rear port of the row. */
	rear: InterfaceJson | null
	/** Front port of the row, if one is mapped there. */
	front: InterfaceJson | null
	/**
	 * Position of the front port on a multi-position rear port; null on a
	 * single-position row. The shared rear port is then shown read-only.
	 */
	position: number | null
	/** Location choices of an outlet rear port. */
	location_options: FormOption[]
	/** Floor plan placement of an outlet rear port, which sets its location. */
	placement?: FloorplanOutletJson
	links: Map<number, TraceLink>
	endToEnd: (ifaceId: number) => TraceEndToEnd[]
	/** A cable was connected or removed; the dialog stays open. */
	on_saved: () => void
	on_close: () => void
}

/**
 * Edit dialog of one patch-panel row: front port, the patched switch and rear
 * port side by side, the way the signal runs, and an outlet's location below
 * (read-only while its floor plan sets it). Cables are connected and removed
 * right away; names, `patched` and the location are saved together
 * (`patched` on every editable port of the row).
 */
export function PanelRowDialog(props: PanelRowDialogProps): JSX.Element {
	const [frontName, setFrontName] = createSignal(props.front?.name ?? '')
	const [rearName, setRearName] = createSignal(props.rear?.name ?? '')
	const [location, setLocation] = createSignal(String(props.rear?.location_id ?? ''))
	const [patched, setPatched] = createSignal(
		(props.position === null ? (props.rear ?? props.front) : props.front)?.patched ?? true,
	)
	const [connecting, setConnecting] = createSignal<InterfaceJson | null>(null)
	const [error, setError] = createSignal<string | null>(null)
	const save = useAction(setError)
	const cable = useAction(setError)

	/** The shared rear port of a position row belongs to its own row. */
	const rearEditable = (): boolean => props.position === null
	const rearOutlet = (): boolean => rearEditable() && props.rear !== null && isOutlet(props.rear)
	/** A placed outlet takes its location from the floor plan. */
	const locationEditable = (): boolean => rearOutlet() && props.placement === undefined
	const title = (): string =>
		t('device.panel.editRow', {
			name: [props.front?.name, props.rear?.name].filter(Boolean).join(' / '),
		})
	/** Cabled ports must stay patched; disconnect them first. */
	const cabled = (): boolean =>
		Boolean(props.front?.connected || (rearEditable() && props.rear?.connected))
	const locked = (): boolean => cabled() && patched()
	const valid = (): boolean =>
		(!props.front || frontName().trim() !== '') &&
		(!props.rear || !rearEditable() || rearName().trim() !== '')

	/** Changed fields of a port; empty when nothing changed. */
	function changesOf(iface: InterfaceJson, name: string): InterfaceUpdate {
		const locationId = parseId(location())
		return {
			...(name.trim() !== iface.name ? { name: name.trim() } : {}),
			...(iface === props.rear && locationEditable() && locationId !== iface.location_id
				? { location_id: locationId }
				: {}),
			...(patched() !== iface.patched ? { patched: patched() } : {}),
		}
	}

	/** Editable ports with their name inputs. */
	const editable = (): { iface: InterfaceJson | null; name: string }[] => [
		{ iface: props.front, name: frontName() },
		{ iface: rearEditable() ? props.rear : null, name: rearName() },
	]

	/** Unsaved name or `patched` changes; cables are saved right away. */
	const dirty = (): boolean =>
		editable().some(
			({ iface, name }) => iface !== null && Object.keys(changesOf(iface, name)).length > 0,
		)

	async function handleSave(e: SubmitEvent): Promise<void> {
		e.preventDefault()
		if (!valid()) {
			return
		}
		const updates = editable().flatMap(({ iface, name }) => {
			const input = iface ? changesOf(iface, name) : {}
			return iface && Object.keys(input).length > 0 ? [{ iface, input }] : []
		})
		for (const { iface, input } of updates) {
			if (!(await save.run(() => update_interface(props.device_id, iface.id, input)))) {
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
		await cable.run(() => delete_cable(cableId))
	}

	/** Current cable of a port, or what keeps it from getting one. */
	const cableOf = (iface: InterfaceJson, readOnly: boolean): JSX.Element => (
		<Show
			when={props.links.get(iface.id)}
			fallback={
				<Show
					when={iface.patched && patched()}
					fallback={
						<span class="panel-port-muted">{t('device.panel.patchToConnect')}</span>
					}
				>
					<span class="panel-row-cable">
						<span class="panel-port-muted">{t('device.notConnected')}</span>
						<Show when={!readOnly && !iface.connected}>
							<button
								type="button"
								class="panel-row-connect"
								aria-label={t('device.connectCableFor', { name: iface.name })}
								onClick={(): void => {
									setError(null)
									setConnecting(iface)
								}}
							>
								<IconLinkPlus size={16} aria-hidden="true" />
								{t('device.connect')}
							</button>
						</Show>
					</span>
				</Show>
			}
		>
			{(link: () => TraceLink): JSX.Element => (
				<span class="panel-row-cable">
					<PortPeer link={link()} endToEnd={props.endToEnd(iface.id)} />
					<Show when={!readOnly}>
						<button
							type="button"
							class="btn-danger panel-row-disconnect"
							disabled={cable.pending()}
							aria-label={t('device.disconnectPort', { name: iface.name })}
							onClick={(): void => void handleDisconnect(link().cable_id)}
						>
							<IconUnlink size={16} aria-hidden="true" />
							{t('device.disconnect')}
						</button>
					</Show>
				</span>
			)}
		</Show>
	)

	/** One side of the row: heading, name and cable. */
	const portCard = (side: {
		id: string
		heading: string
		caption: string
		iface: InterfaceJson | null
		name: string
		setName: (name: string) => void
		readOnly: boolean
		autofocus: boolean
	}): JSX.Element => (
		<section class="panel-row-port" aria-labelledby={`${side.id}-heading`}>
			<div class="panel-row-port-head">
				<h3 id={`${side.id}-heading`}>{side.heading}</h3>
				<span class="panel-port-muted">{side.caption}</span>
			</div>
			<Show when={side.iface} fallback={<span class="panel-port-muted">—</span>}>
				{(iface: () => InterfaceJson): JSX.Element => (
					<>
						<label class="panel-row-field">
							<span>{t('common.name')}</span>
							<input
								id={`${side.id}-name`}
								class="panel-row-name"
								ref={useAutofocus(() => side.autofocus)}
								value={side.name}
								onInput={(
									e: InputEvent & { currentTarget: HTMLInputElement },
								): void => side.setName(e.currentTarget.value)}
								required={!side.readOnly}
								disabled={side.readOnly}
							/>
						</label>
						<div class="panel-row-field">
							<span>{t('device.connection')}</span>
							{cableOf(iface(), side.readOnly)}
						</div>
					</>
				)}
			</Show>
		</section>
	)

	return (
		<>
			<Modal
				title={title()}
				class="panel-row-dialog"
				dirty={dirty()}
				on_close={props.on_close}
			>
				<form class="form-stacked" onSubmit={handleSave}>
					<div class="panel-row-grid">
						{portCard({
							id: 'panel-row-front',
							heading: t('device.panel.frontPort'),
							caption: t('device.panel.frontCaption'),
							iface: props.front,
							name: frontName(),
							setName: setFrontName,
							readOnly: false,
							autofocus: true,
						})}
						<div class="panel-row-bridge" classList={{ 'is-off': !patched() }}>
							<span class="panel-row-switch">
								<input
									id="panel-row-patched"
									type="checkbox"
									role="switch"
									aria-checked={patched()}
									class="toggle"
									checked={patched()}
									disabled={locked()}
									aria-describedby="panel-row-note"
									onChange={(
										e: Event & { currentTarget: HTMLInputElement },
									): void => void setPatched(e.currentTarget.checked)}
								/>
							</span>
							<label for="panel-row-patched">
								{patched()
									? t('device.panel.patched')
									: t('device.panel.notPatched')}
							</label>
							<Show when={locked()}>
								<IconLock size={14} aria-hidden="true" />
							</Show>
						</div>
						{portCard({
							id: 'panel-row-rear',
							heading: t('device.panel.rearPort'),
							caption:
								props.rear && !rearEditable()
									? t('device.panel.positions', { count: props.rear.positions })
									: t('device.panel.rearCaption'),
							iface: props.rear,
							name: rearName(),
							setName: setRearName,
							readOnly: !rearEditable(),
							autofocus: !props.front,
						})}
					</div>
					<Show when={rearOutlet()}>
						<SelectField
							id="panel-row-location"
							label={t('device.panel.location')}
							value={location()}
							onChange={setLocation}
							options={props.location_options}
							emptyLabel={t('device.outletLocation.none')}
							disabled={!locationEditable()}
							hint={
								<Show when={props.placement}>
									{(placement: () => FloorplanOutletJson): JSX.Element => (
										<Hint>
											{t('device.panel.locationFromPlan')}{' '}
											<a
												href={floorplanHref(placement().attachment_id, {
													interface: placement().interface_id,
												})}
											>
												{placement().owner_name}
											</a>
										</Hint>
									)}
								</Show>
							}
						/>
					</Show>
					<p id="panel-row-note" class="panel-row-note">
						<Show when={locked()}>{t('device.panel.cabledPatched')}</Show>
					</p>
					<div class="panel-row-footer">
						<div class="modal-actions">
							<button type="submit" disabled={!valid() || !dirty() || save.pending()}>
								{t('common.save')}
							</button>
							<button
								type="button"
								onClick={() => confirmDiscard(dirty()) && props.on_close()}
							>
								{t('common.cancel')}
							</button>
						</div>
					</div>
				</form>
				<InlineError message={error()} alert />
			</Modal>
			<Show when={connecting()}>
				{(iface: () => InterfaceJson): JSX.Element => (
					<ConnectPortDialog
						iface={iface()}
						on_connected={() => setConnecting(null)}
						on_close={() => setConnecting(null)}
					/>
				)}
			</Show>
		</>
	)
}
