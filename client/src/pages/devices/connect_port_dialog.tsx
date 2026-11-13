import { Combobox } from '@serkonda7/solid-components'
import { Result } from 'better-result'
import { portsCompatible } from 'shared/src/ports'
import type { PortSide } from 'shared/src/schemas'
import type { InputEventAndTarget, TraceLink } from 'shared/src/types'
import type { JSX } from 'solid-js'
import { createMemo, createResource, createSignal, For, Show } from 'solid-js'
import { create_cable, fetch_trace } from '../../api/cables'
import {
	type DeviceRow,
	fetch_devices,
	fetch_interfaces,
	type InterfaceJson,
} from '../../api/devices'
import { fetch_device_types } from '../../api/templates'
import { Empty, InlineError, Loading } from '../../components/feedback'
import type { FormOption } from '../../components/form'
import { Modal } from '../../components/modal'
import { t } from '../../i18n'
import { portKindLabel, portSideLabel } from '../../i18n/labels'
import { useNameOf } from '../../lib/lookup'
import { createRows, useAction } from '../../lib/resource'

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

const isFree = (p: PortOption): boolean => p.compatible && p.iface.patched && !p.iface.connected

/**
 * Cable connect dialog on one page: a searchable device dropdown above the
 * peer device's ports as a filterable tile grid. Clicking a tile selects it
 * for Save; double-clicking it or pressing Enter on it saves right away.
 * Save & next (Shift+Enter on a tile) keeps the dialog open for the next free
 * port of the local device, with the next free peer port selected. Only free ports show unless "free only" is
 * turned off; then incompatible and taken ports are shown disabled.
 */
export function ConnectPortDialog(props: ConnectPortDialogProps): JSX.Element {
	/** Local port the next cable starts at; advanced by connect & next. */
	const [local, setLocal] = createSignal(props.iface)
	/** Selected peer device id as the combobox value; `''` while none is picked. */
	const [peerId, setPeerId] = createSignal('')
	const [peerIface, setPeerIface] = createSignal<InterfaceJson | null>(null)
	const [portFilter, setPortFilter] = createSignal('')
	const [freeOnly, setFreeOnly] = createSignal(true)
	/** Last cable created by connect & next, shown in the footer. */
	const [lastCable, setLastCable] = createSignal<{ from: string; to: string } | null>(null)
	const [refreshing, setRefreshing] = createSignal(false)
	/** True once a cable was created, so closing reports the connection. */
	let connectedAny = false
	const [error, setError] = createSignal<string | null>(null)
	const submit = useAction(setError)

	// Existing cables from the local device, keyed by peer device, so the
	// device dropdown can flag already connected devices.
	const [localLinks, { refetch: refetchLocalLinks }] = createResource(async () => {
		const trace = await fetch_trace(props.iface.device_id, 1)
		const byPeer = new Map<number, TraceLink[]>()
		for (const link of Result.isError(trace) ? [] : trace.value.links) {
			byPeer.set(link.peer_device.id, [...(byPeer.get(link.peer_device.id) ?? []), link])
		}
		return byPeer
	})
	// The local device's ports, in order, to find the next one to connect.
	const [localPorts] = createResource(async (): Promise<InterfaceJson[]> => {
		const res = await fetch_interfaces(props.iface.device_id)
		return Result.isError(res) ? [] : res.value
	})

	// Only devices with a port the local one can be cabled to; the dropdown
	// searches them client-side (pickers load the first 200 rows).
	const [devices] = createResource(
		() => local().id,
		async (localId: number): Promise<DeviceRow[]> => {
			const res = await fetch_devices({ compatible_with: localId })
			if (Result.isError(res)) {
				setError(res.error.message)
				return []
			}
			return res.value.items
		},
	)
	const [types] = createRows(fetch_device_types)
	const typeName = useNameOf(types, (type) => type.model)
	/** Device type, then the existing cables to that device, as the option detail. */
	const deviceOptions = createMemo((): FormOption[] =>
		(devices() ?? []).map((device) => {
			const links = localLinks()
				?.get(device.id)
				?.map((l) => `${l.local_interface.name} ⟷ ${l.peer_interface.name}`)
				.join(', ')
			return {
				value: device.id,
				label: device.name,
				detail: [typeName(device.device_type_id), links].filter(Boolean).join(' · '),
			}
		}),
	)
	const peerDevice = createMemo(
		() => (devices() ?? []).find((device) => String(device.id) === peerId()) ?? null,
	)

	// The depth-1 trace runs in parallel and only names the far end of taken
	// ports; if it fails the tiles fall back to a plain "connected".
	const [peerPorts, { refetch: refetchPeerPorts }] = createResource(
		() => Number(peerId()) || false,
		async (deviceId: number) => {
			const [res, trace] = await Promise.all([
				fetch_interfaces(deviceId),
				fetch_trace(deviceId, 1),
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
				.filter((i) => i.id !== local().id)
				.map(
					(iface): PortOption => ({
						iface,
						compatible: portsCompatible(local(), iface),
						link: links.get(iface.id),
					}),
				)
		},
	)
	/**
	 * Free-only hides every port that cannot be picked; the filter matches the
	 * port name or, for taken ports, the device on the far end.
	 */
	const visiblePorts = createMemo(() => {
		const needle = portFilter().trim().toLowerCase()
		return (peerPorts() ?? []).filter(
			(p) =>
				(!freeOnly() || isFree(p)) &&
				(needle === '' ||
					p.iface.name.toLowerCase().includes(needle) ||
					(p.link?.peer_device.name.toLowerCase().includes(needle) ?? false)),
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
			data-port-id={iface.id}
			disabled={!compatible || !iface.patched || iface.connected || submit.pending()}
			title={
				!compatible
					? t('device.incompatiblePort')
					: !iface.patched
						? t('device.panel.notPatched')
						: link
							? `${link.peer_device.name}: ${link.peer_interface.name}`
							: iface.connected
								? t('device.alreadyConnected')
								: undefined
			}
			onClick={(): void => {
				setPeerIface(iface)
			}}
			onDblClick={(): void => {
				void connect(iface)
			}}
			onKeyDown={(e: KeyboardEvent): void => {
				if (e.key === 'Enter') {
					e.preventDefault()
					void connect(iface, e.shiftKey)
				}
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

	function pickDevice(id: string): void {
		setError(null)
		setPeerIface(null)
		setPortFilter('')
		setPeerId(id)
	}

	/** Next unconnected, patched local port on the same side after `current`. */
	function nextLocalPort(current: InterfaceJson): InterfaceJson | null {
		const ports = localPorts() ?? []
		const at = ports.findIndex((p) => p.id === current.id)
		return (
			ports
				.slice(at + 1)
				.find(
					(p) => (p.side ?? null) === (current.side ?? null) && p.patched && !p.connected,
				) ?? null
		)
	}

	/** Selects and focuses the first visible free peer port after `afterId`, wrapping around. */
	function selectNextFree(afterId: number): void {
		const all = peerPorts() ?? []
		const visible = new Set(visiblePorts().map((p) => p.iface.id))
		const at = all.findIndex((p) => p.iface.id === afterId)
		const pick = (p: PortOption): boolean => isFree(p) && visible.has(p.iface.id)
		const target = all.slice(at + 1).find(pick) ?? all.find(pick)
		if (target) {
			setPeerIface(target.iface)
			document
				.querySelector<HTMLButtonElement>(
					`.connect-dialog [data-port-id="${target.iface.id}"]`,
				)
				?.focus()
		}
	}

	/**
	 * Cables the local port to `peer`. With `next`, the dialog stays open for
	 * the next local port; it closes when there is none.
	 */
	async function connect(peer: InterfaceJson, next = false): Promise<void> {
		if (submit.pending()) {
			return
		}
		const from = local()
		setPeerIface(peer)
		const created = await submit.run(() =>
			create_cable({ a_interface_id: from.id, b_interface_id: peer.id }),
		)
		if (!created) {
			return
		}
		connectedAny = true
		const following = next ? nextLocalPort(from) : null
		if (!following) {
			props.on_connected()
			return
		}
		setLastCable({ from: from.name, to: `${peerDevice()?.name ?? ''}: ${peer.name}` })
		setPeerIface(null)
		setPortFilter('')
		setLocal(following)
		setRefreshing(true)
		await Promise.all([refetchPeerPorts(), refetchLocalLinks()])
		setRefreshing(false)
		queueMicrotask(() => selectNextFree(peer.id))
	}

	/** Closing after connect & next still reports the cables made. */
	function close(): void {
		if (connectedAny) {
			props.on_connected()
		} else {
			props.on_close()
		}
	}

	/** The buttons save; Enter in the filter must not submit the form. */
	function handleSubmit(e: SubmitEvent): void {
		e.preventDefault()
	}

	const title = (): string => t('device.connectToPeer', { name: local().name })

	return (
		<Modal title={title()} class="connect-dialog" on_close={close}>
			<form class="connect-port-form" onSubmit={handleSubmit}>
				<Combobox
					id="connect-peer-device"
					ariaLabel={t('entity.device.one')}
					value={peerId()}
					onChange={pickDevice}
					options={deviceOptions()}
					placeholder={t('rack.searchDevices')}
					searchLabel={t('common.search')}
					noMatchesLabel={t('common.noMatchingObjects')}
					autofocus
				/>
				<div class="connect-port-toolbar">
					<input
						class="object-selector-search"
						placeholder={t('device.filterPorts')}
						aria-label={t('device.filterPorts')}
						value={portFilter()}
						disabled={!peerDevice()}
						onInput={(e: InputEventAndTarget) => setPortFilter(e.currentTarget.value)}
					/>
					<button
						type="button"
						class="connect-free-only"
						aria-pressed={freeOnly()}
						onClick={() => setFreeOnly(!freeOnly())}
					>
						{t('device.freePortsOnly')}
					</button>
				</div>
				<Show
					when={peerDevice()}
					fallback={
						<Show
							when={!devices.loading}
							fallback={<Loading message={t('common.loading')} />}
						>
							<Empty message={t('device.pickPeerDevice')} />
						</Show>
					}
				>
					{/* A refresh after connect & next keeps the tiles (and focus) in place. */}
					<Show
						when={!peerPorts.loading || refreshing()}
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
													group.side !== null || portGroups().length > 1
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
				</Show>
				<div class="connect-footer">
					<p class="connect-summary">
						<Show
							when={peerIface()}
							fallback={
								<Show when={lastCable()}>
									{(cable: () => { from: string; to: string }): JSX.Element => (
										<>
											<span class="connect-summary-done">
												{t('device.connected')}:
											</span>
											<code>{cable().from}</code>
											<span aria-hidden="true">⟷</span>
											<span class="connect-summary-peer">{cable().to}</span>
										</>
									)}
								</Show>
							}
						>
							{(peer: () => InterfaceJson): JSX.Element => (
								<>
									<code>{local().name}</code>
									<span aria-hidden="true">⟷</span>
									<span class="connect-summary-peer">
										{peerDevice()?.name}: <code>{peer().name}</code>
									</span>
								</>
							)}
						</Show>
					</p>
					<div class="form-actions connect-actions">
						<div class="btn-group">
							<button
								type="button"
								disabled={!peerIface() || submit.pending()}
								onClick={() => {
									const peer = peerIface()
									if (peer) {
										void connect(peer)
									}
								}}
							>
								{t('common.save')}
							</button>
							<button
								type="button"
								class="btn-outline"
								title={t('device.connectNextHint')}
								disabled={
									!peerIface() || submit.pending() || !nextLocalPort(local())
								}
								onClick={() => {
									const peer = peerIface()
									if (peer) {
										void connect(peer, true)
									}
								}}
							>
								{t('common.saveAndNext')}
							</button>
						</div>
						<button type="button" onClick={close} disabled={submit.pending()}>
							{t('common.cancel')}
						</button>
					</div>
				</div>
			</form>
			<InlineError message={error()} alert />
		</Modal>
	)
}
