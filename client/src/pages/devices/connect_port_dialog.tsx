import { Result } from 'better-result'
import { portsCompatible } from 'shared/src/ports'
import type { PortSide } from 'shared/src/schemas'
import type { InputEventAndTarget, TraceLink } from 'shared/src/types'
import type { JSX } from 'solid-js'
import { createMemo, createResource, createSignal, For, Show } from 'solid-js'
import { create_cable, fetch_trace } from '../../api/cables'
import { type DeviceRow, fetch_interfaces, type InterfaceJson } from '../../api/devices'
import { Empty, InlineError, Loading } from '../../components/feedback'
import { Modal } from '../../components/modal'
import { ObjectSearch } from '../../components/object_selector'
import { t } from '../../i18n'
import { portKindLabel, portSideLabel } from '../../i18n/labels'
import { useAction } from '../../lib/resource'
import { useDeviceSearch } from './device_search'

/** A peer port, whether the local port can be cabled to it, and when it is taken, the cable's other end. */
interface PortOption {
	iface: InterfaceJson
	compatible: boolean
	link?: TraceLink
}

/** Tile groups of a peer device: its normal ports, then front and rear ports. */
const PORT_GROUPS: readonly (PortSide | null)[] = [null, 'front', 'rear']

const GROUP_HEADINGS = {
	front: 'device.panel.frontPorts',
	rear: 'device.panel.rearPorts',
} as const

export interface ConnectPortDialogProps {
	/** Local port the cable starts at. */
	iface: InterfaceJson
	on_connected: () => void
	on_close: () => void
}

/**
 * Two-step cable connect dialog: search and pick the peer device first, then
 * one of its free ports from a filterable tile grid; clicking a tile (or
 * pressing Enter on it) connects right away. Incompatible and taken ports are
 * shown disabled.
 */
export function ConnectPortDialog(props: ConnectPortDialogProps): JSX.Element {
	const [peerDevice, setPeerDevice] = createSignal<DeviceRow | null>(null)
	const [peerIface, setPeerIface] = createSignal<InterfaceJson | null>(null)
	const [portFilter, setPortFilter] = createSignal('')
	const [error, setError] = createSignal<string | null>(null)
	const submit = useAction(setError)

	// Existing cables from the local device, keyed by peer device, so the
	// device search can flag already connected devices.
	const localLinksPromise = fetch_trace(props.iface.device_id, 1).then((trace) => {
		const byPeer = new Map<number, TraceLink[]>()
		for (const link of Result.isError(trace) ? [] : trace.value.links) {
			byPeer.set(link.peer_device.id, [...(byPeer.get(link.peer_device.id) ?? []), link])
		}
		return byPeer
	})
	const [localLinks] = createResource(() => localLinksPromise)
	// Only devices with a port the local one can be cabled to.
	const deviceSearch = useDeviceSearch(
		(device: DeviceRow) => {
			const links = localLinks()?.get(device.id)
			return links
				?.map((l) => `${l.local_interface.name} ⟷ ${l.peer_interface.name}`)
				.join(', ')
		},
		() => ({ compatible_with: props.iface.id }),
	)

	// The depth-1 trace runs in parallel and only names the far end of taken
	// ports; if it fails the tiles fall back to a plain "connected".
	const [peerPorts] = createResource(peerDevice, async (device: DeviceRow) => {
		const [res, trace] = await Promise.all([
			fetch_interfaces(device.id),
			fetch_trace(device.id, 1),
		])
		if (Result.isError(res)) {
			setError(res.error.message)
			return []
		}
		const links = new Map(
			Result.isError(trace)
				? []
				: trace.value.links.map((link) => [link.local_interface.id, link]),
		)
		return res.value
			.filter((i) => i.id !== props.iface.id)
			.map(
				(iface): PortOption => ({
					iface,
					compatible: portsCompatible(props.iface, iface),
					link: links.get(iface.id),
				}),
			)
	})
	const compatibleCount = (): number => (peerPorts() ?? []).filter((p) => p.compatible).length
	const freeCount = (): number =>
		(peerPorts() ?? []).filter((p) => p.compatible && p.iface.patched && !p.iface.connected)
			.length
	/** Filter matches the port name or, for taken ports, the device on the far end. */
	const visiblePorts = createMemo(() => {
		const needle = portFilter().trim().toLowerCase()
		const all = peerPorts() ?? []
		return needle === ''
			? all
			: all.filter(
					(p) =>
						p.iface.name.toLowerCase().includes(needle) ||
						(p.link?.peer_device.name.toLowerCase().includes(needle) ?? false),
				)
	})

	/** Visible tiles grouped by side; empty groups are left out. */
	const portGroups = createMemo(() =>
		PORT_GROUPS.map((side) => ({
			side,
			ports: visiblePorts().filter((p) => (p.iface.side ?? null) === side),
		})).filter((g) => g.ports.length > 0),
	)

	const portTile = ({ iface, compatible, link }: PortOption): JSX.Element => (
		<button
			type="button"
			class="port-tile"
			classList={{
				selected: peerIface()?.id === iface.id,
			}}
			aria-pressed={peerIface()?.id === iface.id}
			disabled={!compatible || !iface.patched || iface.connected || submit.pending()}
			title={
				!compatible
					? t('device.incompatiblePort')
					: !iface.patched
						? t('device.panel.unpatched')
						: link
							? `${link.peer_device.name}: ${link.peer_interface.name}`
							: iface.connected
								? t('device.alreadyConnected')
								: undefined
			}
			onClick={(): void => {
				void connect(iface)
			}}
		>
			<span class="port-tile-name">
				{iface.name}
				<Show when={iface.side}>
					{(side: () => PortSide): JSX.Element => (
						<>
							{' '}
							<span class="port-side-badge">{portSideLabel(side())}</span>
						</>
					)}
				</Show>
			</span>
			<small>
				{compatible && link
					? `→ ${link.peer_device.name}`
					: compatible && iface.connected
						? t('device.connected')
						: compatible && !iface.patched
							? t('device.panel.notPatched')
							: portKindLabel(iface.kind)}
			</small>
		</button>
	)

	function pickDevice(device: DeviceRow): void {
		setError(null)
		setPeerIface(null)
		setPortFilter('')
		setPeerDevice(device)
	}

	function back(): void {
		setError(null)
		setPeerIface(null)
		setPeerDevice(null)
	}

	async function connect(peer: InterfaceJson): Promise<void> {
		if (submit.pending()) {
			return
		}
		setPeerIface(peer)
		const created = await submit.run(() =>
			create_cable({ a_interface_id: props.iface.id, b_interface_id: peer.id }),
		)
		if (created) {
			props.on_connected()
		}
	}

	/** Tiles connect on click; Enter in the filter must not submit the form. */
	function handleSubmit(e: SubmitEvent): void {
		e.preventDefault()
	}

	const title = (): string => t('device.connectToPeer', { name: props.iface.name })

	return (
		<Modal title={title()} class="connect-dialog" on_close={props.on_close}>
			<ol class="connect-steps">
				<li classList={{ active: !peerDevice(), done: Boolean(peerDevice()) }}>
					<span class="connect-step-num">1</span>
					{t('entity.device.one')}
				</li>
				<li classList={{ active: Boolean(peerDevice()) }}>
					<span class="connect-step-num">2</span>
					{t('device.connectStepPort')}
				</li>
			</ol>
			<Show
				when={peerDevice()}
				fallback={<ObjectSearch {...deviceSearch} on_select={pickDevice} />}
			>
				{(device: () => DeviceRow): JSX.Element => (
					<form class="connect-port-form" onSubmit={handleSubmit}>
						<div class="connect-peer">
							<div class="connect-peer-info">
								<strong>{device().name}</strong>
								<Show when={!peerPorts.loading}>
									<small>
										{t('device.freePortsCount', {
											free: freeCount(),
											total: compatibleCount(),
										})}
									</small>
								</Show>
							</div>
							<button type="button" onClick={back}>
								{t('device.changePeerDevice')}
							</button>
						</div>
						<input
							ref={(el: HTMLInputElement): void => queueMicrotask(() => el.focus())}
							class="object-selector-search"
							placeholder={t('device.filterPorts')}
							aria-label={t('device.filterPorts')}
							value={portFilter()}
							onInput={(e: InputEventAndTarget) =>
								setPortFilter(e.currentTarget.value)
							}
						/>
						<Show
							when={!peerPorts.loading}
							fallback={<Loading message={t('common.loading')} />}
						>
							<Show
								when={(peerPorts() ?? []).length > 0}
								fallback={<Empty message={t('device.noPeerPorts')} />}
							>
								<Show
									when={visiblePorts().length > 0}
									fallback={<Empty message={t('common.noMatchingObjects')} />}
								>
									<For each={portGroups()}>
										{(group: {
											side: PortSide | null
											ports: PortOption[]
										}): JSX.Element => (
											<>
												<Show
													when={
														group.side !== null ||
														portGroups().length > 1
													}
												>
													<h4 class="port-group-heading">
														{group.side === null
															? t('device.panel.otherPorts')
															: t(GROUP_HEADINGS[group.side])}
													</h4>
												</Show>
												<div class="port-grid">
													<For each={group.ports}>{portTile}</For>
												</div>
											</>
										)}
									</For>
								</Show>
							</Show>
						</Show>
						<div class="connect-footer">
							<p class="connect-summary">
								<Show
									when={peerIface()}
									fallback={
										<span class="connect-summary-hint">
											{t('device.pickPeerPort')}
										</span>
									}
								>
									{(peer: () => InterfaceJson): JSX.Element => (
										<>
											<code>{props.iface.name}</code>
											<span aria-hidden="true">⟷</span>
											<span class="connect-summary-peer">
												{device().name}: <code>{peer().name}</code>
											</span>
										</>
									)}
								</Show>
							</p>
							<div class="modal-actions">
								<button type="button" onClick={props.on_close}>
									{t('common.cancel')}
								</button>
							</div>
						</div>
					</form>
				)}
			</Show>
			<InlineError message={error()} alert />
		</Modal>
	)
}
