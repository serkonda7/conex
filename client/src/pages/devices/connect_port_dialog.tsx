import { Result } from 'better-result'
import {
	COPPER_PASS_THROUGH_TYPES,
	DISPLAY_PORT_KINDS,
	GENERAL_PORT_KINDS,
	PASS_THROUGH_PORT_TYPES,
	type PortSide,
	SERIAL_PORT_KINDS,
	USB_PORT_KINDS,
} from 'shared/src/schemas'
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

/** Interface kinds that never connect to network ports. */
export const OTHER_PORT_KINDS = new Set<string>([
	'port',
	...GENERAL_PORT_KINDS,
	'power',
	'power-outlet',
	...DISPLAY_PORT_KINDS,
])

const POWER_PORT_KINDS = new Set(['power', 'power-outlet'])

/** Patch-panel connectors (fiber, …) that only cable to their own kind; copper cables like ethernet. */
const SAME_KIND_PASS_THROUGH = new Set<string>(
	Object.keys(PASS_THROUGH_PORT_TYPES).filter(
		(k) => !(COPPER_PASS_THROUGH_TYPES as readonly string[]).includes(k),
	),
)

/** Pass-through group of a panel port (its rear port's id); see `server/src/db/cables.ts`. */
function passThroughGroup(iface: InterfaceJson): number | null {
	if (iface.side === 'rear') {
		return iface.id
	}
	return iface.side === 'front' ? iface.rear_port_id : null
}

/** Connector families cabled across connectors (rollover, USB-A to USB-C, …). */
const PORT_FAMILIES = [new Set<string>(SERIAL_PORT_KINDS), new Set<string>(USB_PORT_KINDS)]

/**
 * Network ports pair with network ports; a power port pairs with a power port
 * or outlet (never outlet to outlet); general ports pair within their
 * connector family, a plain `port` with any general port; display and fiber
 * only with the same kind. Two ports of one pass-through never pair.
 */
function isCompatible(local: InterfaceJson, peer: InterfaceJson): boolean {
	const group = passThroughGroup(local)
	if (group !== null && group === passThroughGroup(peer)) {
		return false
	}
	if (SAME_KIND_PASS_THROUGH.has(local.kind) || SAME_KIND_PASS_THROUGH.has(peer.kind)) {
		return local.kind === peer.kind
	}
	if (POWER_PORT_KINDS.has(local.kind) && POWER_PORT_KINDS.has(peer.kind)) {
		return local.kind === 'power' || peer.kind === 'power'
	}
	if (isGeneralPort(local.kind) && isGeneralPort(peer.kind)) {
		return (
			local.kind === 'port' ||
			peer.kind === 'port' ||
			PORT_FAMILIES.some((f) => f.has(local.kind) && f.has(peer.kind))
		)
	}
	if (OTHER_PORT_KINDS.has(local.kind) || OTHER_PORT_KINDS.has(peer.kind)) {
		return local.kind === peer.kind
	}
	return true
}

function isGeneralPort(kind: string): boolean {
	return kind === 'port' || (GENERAL_PORT_KINDS as readonly string[]).includes(kind)
}

/** A candidate peer port plus, when it is taken, the cable's other end. */
interface PortOption {
	iface: InterfaceJson
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
 * one of its free, compatible ports from a filterable tile grid (double-click
 * a tile to connect right away).
 */
export function ConnectPortDialog(props: ConnectPortDialogProps): JSX.Element {
	const [peerDevice, setPeerDevice] = createSignal<DeviceRow | null>(null)
	const [peerIface, setPeerIface] = createSignal<InterfaceJson | null>(null)
	const [portFilter, setPortFilter] = createSignal('')
	const [error, setError] = createSignal<string | null>(null)
	const submit = useAction(setError)

	// Existing cables from the local device, keyed by peer device, so the
	// device search can flag already connected devices and list them last.
	const localLinksPromise = fetch_trace(props.iface.device_id, 1).then((trace) => {
		const byPeer = new Map<number, TraceLink[]>()
		for (const link of Result.isError(trace) ? [] : trace.value.links) {
			byPeer.set(link.peer_device.id, [...(byPeer.get(link.peer_device.id) ?? []), link])
		}
		return byPeer
	})
	const [localLinks] = createResource(() => localLinksPromise)
	const deviceSearch = useDeviceSearch((device: DeviceRow) => {
		const links = localLinks()?.get(device.id)
		return links?.map((l) => `${l.local_interface.name} ⟷ ${l.peer_interface.name}`).join(', ')
	})

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
			.filter((i) => i.id !== props.iface.id && isCompatible(props.iface, i))
			.map((iface): PortOption => ({ iface, link: links.get(iface.id) }))
	})
	const freeCount = (): number => (peerPorts() ?? []).filter((p) => !p.iface.connected).length
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

	const portTile = ({ iface, link }: PortOption): JSX.Element => (
		<button
			type="button"
			class="port-tile"
			classList={{
				selected: peerIface()?.id === iface.id,
			}}
			aria-pressed={peerIface()?.id === iface.id}
			disabled={iface.connected}
			title={
				link
					? `${link.peer_device.name}: ${link.peer_interface.name}`
					: iface.connected
						? t('device.alreadyConnected')
						: undefined
			}
			onClick={(): void => {
				setPeerIface(iface)
			}}
			onDblClick={(): void => void connect(iface)}
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
				{link
					? `→ ${link.peer_device.name}`
					: iface.connected
						? t('device.connected')
						: portKindLabel(iface.kind)}
			</small>
		</button>
	)

	/** Device search results with already connected devices sorted last. */
	async function loadDevices(search: string): Promise<Result<DeviceRow[], Error>> {
		const [res, links] = await Promise.all([deviceSearch.load(search), localLinksPromise])
		return res.map((devices) =>
			devices.toSorted((a, b) => Number(links.has(a.id)) - Number(links.has(b.id))),
		)
	}

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

	async function connect(peer: InterfaceJson | null): Promise<void> {
		if (!peer) {
			setError(t('device.pickPeerPort'))
			return
		}
		if (submit.pending()) {
			return
		}
		const created = await submit.run(() =>
			create_cable({ a_interface_id: props.iface.id, b_interface_id: peer.id }),
		)
		if (created) {
			props.on_connected()
		}
	}

	function handleSubmit(e: SubmitEvent): void {
		e.preventDefault()
		void connect(peerIface())
	}

	const title = (): string => t('device.connectToPeer', { name: props.iface.name })

	return (
		<Modal title={title()} class="connect-dialog" on_close={props.on_close}>
			<ol class="connect-steps">
				<li classList={{ active: !peerDevice(), done: Boolean(peerDevice()) }}>
					<span class="connect-step-num">1</span>
					{t('device.connectStepDevice')}
				</li>
				<li classList={{ active: Boolean(peerDevice()) }}>
					<span class="connect-step-num">2</span>
					{t('device.connectStepPort')}
				</li>
			</ol>
			<Show
				when={peerDevice()}
				fallback={
					<ObjectSearch {...deviceSearch} load={loadDevices} on_select={pickDevice} />
				}
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
											total: (peerPorts() ?? []).length,
										})}
									</small>
								</Show>
							</div>
							<button type="button" onClick={back}>
								{t('device.changePeerDevice')}
							</button>
						</div>
						<input
							autofocus
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
								<button type="submit" disabled={!peerIface() || submit.pending()}>
									{t('device.connect')}
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
