import { DataTable } from '@serkonda7/solid-components'
import { IconLinkPlus } from '@tabler/icons-solidjs'
import { Result } from 'better-result'
import type { InputEventAndTarget, TraceLink, TracePath } from 'shared/src/types'
import type { JSX } from 'solid-js'
import { createMemo, createResource, createSignal, For, Show } from 'solid-js'
import { type CableRow, create_cable, delete_cable, fetch_cables, fetch_trace } from '../api_cables'
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
} from '../api_devices'
import { fetch_rack } from '../api_racks'
import { fetch_shelf } from '../api_shelves'
import { fetch_device_types } from '../api_templates'
import { fetch_locations, fetch_site, fetch_tenant } from '../api_tenancy'
import {
	DetailCard,
	DetailHeader,
	DetailShell,
	DetailSubtitle,
	Empty,
	ForeignKeyLink,
	InlineError,
	useDetailDelete,
} from '../components/detail_page'
import { go } from '../components/list_page'

/**
 * /devices/:id — detail with the interface list (port status dots), a manual
 * interface add/rename form, a rack remount form, the P5 cable connect
 * dialog (free-port pickers on both ends), the per-device trace peer links
 * (`dev:port <-> dev:port`), and the cable list with disconnect.
 */
export function DeviceDetailPage(props: { id: number }): JSX.Element {
	const [error, setError] = createSignal<string | null>(null)
	const [ifaceName, setIfaceName] = createSignal('')
	const [moveU, setMoveU] = createSignal('')
	const [localIface, setLocalIface] = createSignal('')
	const [peerDevice, setPeerDevice] = createSignal('')
	const [peerIface, setPeerIface] = createSignal('')
	const [cableLabel, setCableLabel] = createSignal('')
	const [traceDepth, setTraceDepth] = createSignal('4')

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
	const traceSource = createMemo(() => ({ id: props.id, depth: Number(traceDepth()) || 4 }))
	const [trace, { refetch: refetchTrace }] = createResource(traceSource, async (s) => {
		const res = await fetch_trace(s.id, s.depth)
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
	const [types] = createResource(async () => {
		const res = await fetch_device_types()
		if (Result.isError(res)) {
			return []
		}
		return res.value.items
	})
	const siteId = createMemo(() => device()?.site_id ?? null)
	const [site] = createResource(siteId, async (id: number | null) => {
		if (!id) {
			return null
		}
		const res = await fetch_site(id)
		if (Result.isError(res)) {
			setError(res.error.message)
			return null
		}
		return res.value
	})
	const rackId = createMemo(() => device()?.rack_id ?? null)
	const [rack] = createResource(rackId, async (id: number | null) => {
		if (!id) {
			return null
		}
		const res = await fetch_rack(id)
		if (Result.isError(res)) {
			setError(res.error.message)
			return null
		}
		return res.value
	})
	const shelfId = createMemo(() => device()?.shelf_id ?? null)
	const [shelf] = createResource(shelfId, async (id: number | null) => {
		if (!id) {
			return null
		}
		const res = await fetch_shelf(id)
		if (Result.isError(res)) {
			setError(res.error.message)
			return null
		}
		return res.value
	})
	const locationId = createMemo(() => device()?.location_id ?? null)
	const [locationName] = createResource(
		() => ({ site: siteId(), location: locationId() }),
		async ({ site: siteKey, location: locationKey }) => {
			if (!siteKey || !locationKey) {
				return null
			}
			const res = await fetch_locations(siteKey)
			if (Result.isError(res)) {
				setError(res.error.message)
				return null
			}
			return res.value.items.find((l) => l.id === locationKey)?.name ?? null
		},
	)
	const tenantId = createMemo(() => device()?.tenant_id ?? null)
	const [tenant] = createResource(tenantId, async (id: number | null) => {
		if (!id) {
			return null
		}
		const res = await fetch_tenant(id)
		if (Result.isError(res)) {
			setError(res.error.message)
			return null
		}
		return res.value
	})
	const [peerIfaces] = createResource(
		() => peerDevice(),
		async (peerId: string) => {
			if (!peerId) {
				return []
			}
			const res = await fetch_interfaces(Number(peerId))
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
			setError('Rack position must be a positive integer or empty')
			return
		}
		const res = await move_device(props.id, {
			position_u: position ?? null,
		})
		if (Result.isError(res)) {
			setError(res.error.message)
			return
		}
		setMoveU('')
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
			a_interface_id: Number(localIface()),
			b_interface_id: Number(peerIface()),
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

	async function handleDisconnect(cableId: number): Promise<void> {
		setError(null)
		const res = await delete_cable(cableId)
		if (Result.isError(res)) {
			setError(res.error.message)
			return
		}
		refetchAll()
	}

	const { handleDelete } = useDetailDelete({
		noun: 'device',
		name: () => device()?.name,
		id: props.id,
		remove: delete_device,
		setError,
		listRoute: '/devices',
	})

	function typeNameOf(id: number | undefined): string {
		if (id === undefined) {
			return '—'
		}
		return types()?.find((t) => t.id === id)?.model ?? String(id)
	}

	async function handleRename(iface: InterfaceJson): Promise<void> {
		setError(null)
		const renamed = window.prompt('Rename interface', iface.name)
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
	}

	function handleConnectCable(iface: InterfaceJson): void {
		setError(null)
		setLocalIface(String(iface.id))
		document.querySelector('#device-connect')?.scrollIntoView({ behavior: 'smooth' })
	}

	const ifaceCount = (): number => ifaces()?.length ?? 0
	const traceCount = (): number => trace()?.links.length ?? 0
	const cableCount = (): number => cables()?.length ?? 0

	return (
		<div>
			<DetailShell
				backTo="/devices"
				backLabel="Devices"
				loading={device.loading}
				loadingText="Gerät wird geladen…"
				record={device()}
				emptyText="Device not found."
			>
				<DetailHeader
					name={device()?.name}
					editHref={`/devices/${props.id}/edit`}
					onDelete={handleDelete}
				/>
				<DetailSubtitle>{device()?.description || 'No description.'}</DetailSubtitle>

				<div class="detail-stats">
					<a class="detail-stat" href="#device-interfaces">
						<span class="detail-stat-value">{ifaceCount()}</span>{' '}
						<span class="detail-stat-label">
							Interface{ifaceCount() === 1 ? '' : 's'}
						</span>
					</a>
					<a class="detail-stat" href="#device-trace">
						<span class="detail-stat-value">{traceCount()}</span>{' '}
						<span class="detail-stat-label">
							Trace link{traceCount() === 1 ? '' : 's'}
						</span>
					</a>
					<a class="detail-stat" href="#device-cables">
						<span class="detail-stat-value">{cableCount()}</span>{' '}
						<span class="detail-stat-label">Cable{cableCount() === 1 ? '' : 's'}</span>
					</a>
				</div>

				<DetailCard label="Gerätedetails">
					<dt>Typ</dt>
					<dd>{typeNameOf(device()?.device_type_id)}</dd>
					<dt>Beschreibung</dt>
					<dd>{device()?.description || '—'}</dd>
					<dt>Seriennummer</dt>
					<dd>{device()?.serial ?? '—'}</dd>
					<dt>Standort</dt>
					<dd>
						<ForeignKeyLink
							id={siteId()}
							loading={site.loading}
							name={site()?.name}
							href={`/sites/${siteId() ?? ''}`}
						/>
					</dd>
					<dt>Bereich</dt>
					<dd>
						<ForeignKeyLink
							id={locationId()}
							loading={locationName.loading}
							name={locationName()}
						/>
					</dd>
					<dt>Rack</dt>
					<dd>
						<ForeignKeyLink
							id={rackId()}
							loading={rack.loading}
							name={rack()?.name}
							href={`/racks/${rackId() ?? ''}`}
						/>
					</dd>
					<dt>Seite</dt>
					<dd>{device()?.face ?? '—'}</dd>
					<dt>Position</dt>
					<dd>
						{device()?.position_u !== null && device()?.position_u !== undefined ? (
							<code>HE{device()?.position_u}</code>
						) : shelfId() !== null ? (
							<ForeignKeyLink
								id={shelfId()}
								loading={shelf.loading}
								name={`Fachboden ${shelf()?.name || `HE${shelf()?.position_u ?? ''}`}`}
								href={`/shelves/${shelfId() ?? ''}/edit`}
							/>
						) : (
							<span>unracked</span>
						)}
					</dd>
					<dt>Mandant</dt>
					<dd>
						<ForeignKeyLink
							id={tenantId()}
							loading={tenant.loading}
							name={tenant()?.name}
							href={`/tenants/${tenantId() ?? ''}`}
						/>
					</dd>
				</DetailCard>
			</DetailShell>
			<h3>Move</h3>
			<form onSubmit={handleMove}>
				<input
					placeholder="Position (empty clears)"
					inputmode="numeric"
					value={moveU()}
					onInput={(e: InputEventAndTarget) => setMoveU(e.currentTarget.value)}
				/>
				<button type="submit">Verschieben</button>
			</form>
			<h3 id="device-interfaces">Interfaces ({ifaces()?.length ?? 0})</h3>
			<form onSubmit={handleAddIface}>
				<input
					placeholder="Interface name (e.g. mgmt1)"
					value={ifaceName()}
					onInput={(e: InputEventAndTarget) => setIfaceName(e.currentTarget.value)}
				/>
				<button type="submit">Anschluss hinzufügen</button>
			</form>
			<DataTable
				rows={() => ifaces() ?? []}
				getRowId={(iface: InterfaceJson): number => iface.id}
				showColumnCustomizer
				columns={[
					{
						key: 'status',
						label: 'Status',
						getValue: (iface: InterfaceJson): JSX.Element => (
							<span title={iface.connected ? 'connected' : 'free'}>
								<span
									class={
										iface.connected ? 'status-dot-connected' : 'status-dot-free'
									}
								>
									●
								</span>
							</span>
						),
					},
					{
						key: 'name',
						label: 'Name',
						getValue: (iface: InterfaceJson): JSX.Element => <code>{iface.name}</code>,
					},
					{
						key: 'kind',
						label: 'Kind',
						getValue: (iface: InterfaceJson): string => iface.kind,
					},
				]}
				rowActions={(iface: InterfaceJson): JSX.Element => (
					<span class="row-actions">
						<button
							type="button"
							class="icon-btn icon-btn-connect"
							disabled={iface.connected}
							title={
								iface.connected
									? 'Already connected'
									: `Connect ${iface.name} to a peer port`
							}
							aria-label={`Connect cable for ${iface.name}`}
							onClick={() => handleConnectCable(iface)}
						>
							<IconLinkPlus size={20} />
						</button>
						<button type="button" onClick={() => handleRename(iface)}>
							Rename
						</button>
					</span>
				)}
				empty={false}
			/>
			<h3 id="device-connect">Kabel verbinden</h3>
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
				<button type="submit">Verbinden</button>
			</form>
			<h3 id="device-trace">Pfad ({trace()?.links.length ?? 0})</h3>
			<label>
				<span class="visually-hidden">Pfadtiefe</span>
				<select
					aria-label="Trace depth"
					value={traceDepth()}
					onChange={(e: Event & { currentTarget: HTMLSelectElement }) =>
						setTraceDepth(e.currentTarget.value)
					}
				>
					<option value="1">Depth 1</option>
					<option value="2">Depth 2</option>
					<option value="3">Depth 3</option>
					<option value="4">Depth 4</option>
					<option value="6">Depth 6</option>
					<option value="10">Depth 10</option>
				</select>
			</label>{' '}
			<a href="/topology" onClick={(e: MouseEvent): void => go(e, '/topology')}>
				Open in topology
			</a>
			<Show
				when={(trace()?.links ?? []).length > 0}
				fallback={
					<Empty message="Noch kein Kabelpfad vorhanden. Verbinden Sie unten das erste Kabel." />
				}
			>
				<ul>
					<For each={trace()?.links ?? []}>
						{(link: TraceLink): JSX.Element => (
							<li>
								<code>
									{device()?.name}:{link.local_interface.name} ↔{' '}
									{link.peer_device.name}:{link.peer_interface.name}
								</code>{' '}
								{link.cable_label ? <span>({link.cable_label})</span> : null}{' '}
								<button
									type="button"
									class="btn-danger"
									onClick={() => handleDisconnect(link.cable_id)}
								>
									Disconnect
								</button>
							</li>
						)}
					</For>
				</ul>
			</Show>
			<Show when={(trace()?.paths ?? []).length > 0}>
				<h4>Multi-hop paths ({trace()?.paths.length ?? 0})</h4>
				<ul>
					<For each={trace()?.paths ?? []}>
						{(path: TracePath): JSX.Element => (
							<li>
								<code>
									{path.hops
										.map(
											(h) =>
												`${h.from_device.name}:${h.from_interface.name} → ${h.to_device.name}:${h.to_interface.name}`,
										)
										.join(' · ')}
								</code>{' '}
								→{' '}
								<a
									href={`/devices/${path.end_device.id}`}
									onClick={(e: MouseEvent): void =>
										go(e, `/devices/${path.end_device.id}`)
									}
								>
									{path.end_device.name}
								</a>
							</li>
						)}
					</For>
				</ul>
			</Show>
			<h3 id="device-cables">
				Cables ({cables()?.length ?? 0}){' '}
				<a
					href={`/connections?device=${props.id}`}
					onClick={(e: MouseEvent): void => go(e, `/connections?device=${props.id}`)}
				>
					View all
				</a>
			</h3>
			<DataTable
				rows={() => cables() ?? []}
				getRowId={(cable: CableRow): number => cable.id}
				showColumnCustomizer
				columns={[
					{
						key: 'label',
						label: 'Label',
						getValue: (cable: CableRow): string => cable.label ?? '—',
					},
					{
						key: 'status',
						label: 'Status',
						getValue: (cable: CableRow): JSX.Element => (
							<span class="badge">{cable.status}</span>
						),
					},
					{
						key: 'kind',
						label: 'Kind',
						getValue: (cable: CableRow): string => cable.kind ?? '—',
					},
				]}
				rowActions={(cable: CableRow): JSX.Element => (
					<button
						type="button"
						class="btn-danger"
						onClick={() => handleDisconnect(cable.id)}
					>
						Disconnect
					</button>
				)}
				emptyContent={<Empty message="Für dieses Gerät sind noch keine Kabel vorhanden." />}
			/>
			<InlineError message={error()} />
		</div>
	)
}
