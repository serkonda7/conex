import { Result } from 'better-result'
import type { TraceLink } from 'shared/src/schemas'
import type { InputEventAndTarget } from 'shared/src/types'
import type { JSX } from 'solid-js'
import { createResource, createSignal, For, Show } from 'solid-js'
import {
	add_interface,
	type DeviceRow,
	delete_device,
	fetch_device,
	fetch_devices,
	fetch_interfaces,
	type InterfaceJson,
	move_device,
	update_interface,
} from '../api_p4'
import { type CableRow, create_cable, delete_cable, fetch_cables, fetch_trace } from '../api_p5'
import { navigate } from '../router'

function go(e: MouseEvent, to: string): void {
	e.preventDefault()
	navigate(to)
}

/**
 * /devices/:id — detail with the interface list (port status dots), a manual
 * interface add/rename form, a rack/shelf remount form, the P5 cable connect
 * dialog (free-port pickers on both ends), the per-device trace peer links
 * (`dev:port <-> dev:port`), and the cable list with disconnect.
 */
export function DeviceDetailPage(props: { id: string }): JSX.Element {
	const [error, setError] = createSignal<string | null>(null)
	const [ifaceName, setIfaceName] = createSignal('')
	const [moveU, setMoveU] = createSignal('')
	const [moveShelf, setMoveShelf] = createSignal('')
	const [localIface, setLocalIface] = createSignal('')
	const [peerDevice, setPeerDevice] = createSignal('')
	const [peerIface, setPeerIface] = createSignal('')
	const [cableLabel, setCableLabel] = createSignal('')

	const [device, { refetch: refetchDevice }] = createResource(async () => {
		const res = await fetch_device(props.id)
		if (Result.isError(res)) {
			setError(res.error.message)
			return null
		}
		return res.value
	})
	const [ifaces, { refetch: refetchIfaces }] = createResource(async () => {
		const res = await fetch_interfaces(props.id)
		if (Result.isError(res)) {
			setError(res.error.message)
			return []
		}
		return res.value
	})
	const [trace, { refetch: refetchTrace }] = createResource(async () => {
		const res = await fetch_trace(props.id)
		if (Result.isError(res)) {
			setError(res.error.message)
			return null
		}
		return res.value
	})
	const [cables, { refetch: refetchCables }] = createResource(async () => {
		const res = await fetch_cables({ device: props.id })
		if (Result.isError(res)) {
			setError(res.error.message)
			return []
		}
		return res.value.items
	})
	const [devices] = createResource(async () => {
		const res = await fetch_devices()
		if (Result.isError(res)) {
			return []
		}
		return res.value.items.filter((d) => d.id !== props.id)
	})
	const [peerIfaces] = createResource(
		() => peerDevice(),
		async (peerId: string) => {
			if (!peerId) {
				return []
			}
			const res = await fetch_interfaces(peerId)
			if (Result.isError(res)) {
				setError(res.error.message)
				return []
			}
			return res.value
		},
	)

	function refetchAll(): void {
		void refetchIfaces()
		void refetchTrace()
		void refetchCables()
	}

	function freeLocal(): InterfaceJson[] {
		return (ifaces() ?? []).filter((i) => !i.connected)
	}

	function freePeer(): InterfaceJson[] {
		return (peerIfaces() ?? []).filter((i) => !i.connected)
	}

	async function handleAddIface(e: SubmitEvent): Promise<void> {
		e.preventDefault()
		setError(null)
		const res = await add_interface(props.id, { name: ifaceName() })
		if (Result.isError(res)) {
			setError(res.error.message)
			return
		}
		setIfaceName('')
		void refetchIfaces()
	}

	async function handleMove(e: SubmitEvent): Promise<void> {
		e.preventDefault()
		setError(null)
		const position = moveU().trim() === '' ? undefined : Number(moveU().trim())
		if (position !== undefined && (!Number.isInteger(position) || position < 1)) {
			setError('Rack position must be a positive U number or empty')
			return
		}
		const shelf = moveShelf().trim() === '' ? undefined : moveShelf().trim()
		if (position === undefined && shelf === undefined) {
			setError('Enter a U position or a shelf id to move')
			return
		}
		const res = await move_device(props.id, {
			position_u: position ?? null,
			shelf_id: shelf ?? null,
		})
		if (Result.isError(res)) {
			setError(res.error.message)
			return
		}
		setMoveU('')
		setMoveShelf('')
		void refetchDevice()
	}

	async function handleConnect(e: SubmitEvent): Promise<void> {
		e.preventDefault()
		setError(null)
		if (!localIface() || !peerIface()) {
			setError('Pick a free port on both ends first')
			return
		}
		const res = await create_cable({
			a_interface_id: localIface(),
			b_interface_id: peerIface(),
			label: cableLabel().trim() === '' ? undefined : cableLabel().trim(),
		})
		if (Result.isError(res)) {
			setError(res.error.message)
			return
		}
		setLocalIface('')
		setPeerIface('')
		setCableLabel('')
		refetchAll()
	}

	async function handleDisconnect(cableId: string): Promise<void> {
		setError(null)
		const res = await delete_cable(cableId)
		if (Result.isError(res)) {
			setError(res.error.message)
			return
		}
		refetchAll()
	}

	return (
		<div>
			<p>
				<a href="/devices" onClick={(e: MouseEvent): void => go(e, '/devices')}>
					← Devices
				</a>
			</p>
			<Show when={device()} fallback={<p>Loading device…</p>}>
				<h2>{device()?.name}</h2>
				<p>
					Status: {device()?.status} · Asset: {device()?.asset_tag ?? '—'} · Serial:{' '}
					{device()?.serial ?? '—'}
				</p>
				<p>
					Mount:{' '}
					{device()?.shelf_id ? (
						<code>shelf:{device()?.shelf_id?.slice(0, 8)}</code>
					) : device()?.position_u !== null ? (
						<code>U{device()?.position_u}</code>
					) : (
						<span>unracked</span>
					)}
				</p>
				<h3>Move</h3>
				<form onSubmit={handleMove}>
					<input
						placeholder="U position (empty clears)"
						inputmode="numeric"
						value={moveU()}
						onInput={(e: InputEventAndTarget) => setMoveU(e.currentTarget.value)}
					/>
					<input
						placeholder="Shelf id (empty clears)"
						value={moveShelf()}
						onInput={(e: InputEventAndTarget) => setMoveShelf(e.currentTarget.value)}
					/>
					<button type="submit">Move</button>
				</form>
				<p>
					<button
						type="button"
						onClick={async () => {
							setError(null)
							const res = await delete_device(props.id)
							if (Result.isError(res)) {
								setError(res.error.message)
								return
							}
							navigate('/devices')
						}}
					>
						Delete device
					</button>
				</p>
			</Show>

			<h3>Interfaces ({ifaces()?.length ?? 0})</h3>
			<form onSubmit={handleAddIface}>
				<input
					placeholder="Interface name (e.g. mgmt0)"
					value={ifaceName()}
					onInput={(e: InputEventAndTarget) => setIfaceName(e.currentTarget.value)}
				/>
				<button type="submit">Add interface</button>
			</form>
			<table>
				<thead>
					<tr>
						<th>Status</th>
						<th>Name</th>
						<th>Kind</th>
						<th>Actions</th>
					</tr>
				</thead>
				<tbody>
					<For each={ifaces() ?? []}>
						{(iface: InterfaceJson): JSX.Element => (
							<tr>
								<td title={iface.connected ? 'connected' : 'free'}>
									<span style={{ color: iface.connected ? 'green' : 'gray' }}>
										●
									</span>
								</td>
								<td>
									<code>{iface.name}</code>
								</td>
								<td>{iface.kind}</td>
								<td>
									<button
										type="button"
										onClick={async () => {
											setError(null)
											const renamed = window.prompt(
												'Rename interface',
												iface.name,
											)
											if (!renamed || renamed === iface.name) {
												return
											}
											const res = await update_interface(props.id, iface.id, {
												name: renamed,
											})
											if (Result.isError(res)) {
												setError(res.error.message)
												return
											}
											void refetchIfaces()
										}}
									>
										Rename
									</button>
								</td>
							</tr>
						)}
					</For>
				</tbody>
			</table>

			<h3>Connect a cable</h3>
			<form onSubmit={handleConnect}>
				<select
					value={localIface()}
					onChange={(e: Event & { currentTarget: HTMLSelectElement }) =>
						setLocalIface(e.currentTarget.value)
					}
					aria-label="Local free port"
				>
					<option value="">Local free port…</option>
					<For each={freeLocal()}>
						{(iface: InterfaceJson): JSX.Element => (
							<option value={iface.id}>{iface.name}</option>
						)}
					</For>
				</select>{' '}
				<select
					value={peerDevice()}
					onChange={(e: Event & { currentTarget: HTMLSelectElement }) => {
						setPeerDevice(e.currentTarget.value)
						setPeerIface('')
					}}
					aria-label="Peer device"
				>
					<option value="">Peer device…</option>
					<For each={devices() ?? []}>
						{(d: DeviceRow): JSX.Element => <option value={d.id}>{d.name}</option>}
					</For>
				</select>{' '}
				<select
					value={peerIface()}
					onChange={(e: Event & { currentTarget: HTMLSelectElement }) =>
						setPeerIface(e.currentTarget.value)
					}
					aria-label="Peer free port"
				>
					<option value="">Peer free port…</option>
					<For each={freePeer()}>
						{(iface: InterfaceJson): JSX.Element => (
							<option value={iface.id}>{iface.name}</option>
						)}
					</For>
				</select>{' '}
				<input
					placeholder="Label (optional)"
					value={cableLabel()}
					onInput={(e: InputEventAndTarget) => setCableLabel(e.currentTarget.value)}
				/>{' '}
				<button type="submit">Connect</button>
			</form>

			<h3>Trace ({trace()?.links.length ?? 0})</h3>
			<ul>
				<For each={trace()?.links ?? []}>
					{(link: TraceLink): JSX.Element => (
						<li>
							<code>
								{device()?.name}:{link.local_interface.name} ↔{' '}
								{link.peer_device.name}:{link.peer_interface.name}
							</code>{' '}
							{link.cable_label ? <span>({link.cable_label})</span> : null}{' '}
							<button type="button" onClick={() => handleDisconnect(link.cable_id)}>
								Disconnect
							</button>
						</li>
					)}
				</For>
			</ul>

			<h3>Cables ({cables()?.length ?? 0})</h3>
			<table>
				<thead>
					<tr>
						<th>Label</th>
						<th>Status</th>
						<th>Kind</th>
						<th>Actions</th>
					</tr>
				</thead>
				<tbody>
					<For each={cables() ?? []}>
						{(cable: CableRow): JSX.Element => (
							<tr>
								<td>{cable.label ?? '—'}</td>
								<td>{cable.status}</td>
								<td>{cable.kind ?? '—'}</td>
								<td>
									<button
										type="button"
										onClick={() => handleDisconnect(cable.id)}
									>
										Disconnect
									</button>
								</td>
							</tr>
						)}
					</For>
				</tbody>
			</table>
			<Show when={error()}>
				<div class="app-inline-error">{error()}</div>
			</Show>
		</div>
	)
}
