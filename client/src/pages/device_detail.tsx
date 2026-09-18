import { Result } from 'better-result'
import type { InputEventAndTarget } from 'shared/src/types'
import type { JSX } from 'solid-js'
import { createResource, createSignal, For, Show } from 'solid-js'
import {
	add_interface,
	delete_device,
	fetch_device,
	fetch_interfaces,
	type InterfaceJson,
	move_device,
	update_interface,
} from '../api_p4'
import { navigate } from '../router'

function go(e: MouseEvent, to: string): void {
	e.preventDefault()
	navigate(to)
}

/**
 * /devices/:id — detail with the interface list (port status dots), a manual
 * interface add/rename form, and a rack/shelf remount form. The per-port
 * connect dialog arrives in P5; the button below is a placeholder.
 */
export function DeviceDetailPage(props: { id: string }): JSX.Element {
	const [error, setError] = createSignal<string | null>(null)
	const [ifaceName, setIfaceName] = createSignal('')
	const [moveU, setMoveU] = createSignal('')
	const [moveShelf, setMoveShelf] = createSignal('')

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
										title="Cable connect arrives in P5"
										onClick={async () => {
											setError('Cable connect arrives in P5')
										}}
									>
										Connect
									</button>{' '}
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
			<Show when={error()}>
				<div class="app-inline-error">{error()}</div>
			</Show>
		</div>
	)
}
