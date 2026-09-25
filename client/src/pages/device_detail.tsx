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
import { DataTable } from '../components/data_table'
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
import { t, tp } from '../i18n'
import { cableStatusLabel, faceLabel } from '../i18n/labels'
import { type Crumb, goTo } from '../router'
import { locationTrail } from '../trails'

/** Selectable trace depths for the path view. */
const TRACE_DEPTHS = [1, 2, 3, 4, 6, 10]

function faceLabelOrDash(face: string | null | undefined): string {
	return face ? faceLabel(face) : '—'
}

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
	const [trail] = createResource(
		() => ({ site: site(), location: locationId(), rack: rack() }),
		async ({ site: siteRow, location: locationKey, rack: rackRow }): Promise<Crumb[]> => {
			const locations = siteRow ? await locationTrail(siteRow.id, locationKey) : []
			return [
				...(siteRow ? [{ label: siteRow.name, href: `/sites/${siteRow.id}` }] : []),
				...locations,
				...(rackRow ? [{ label: rackRow.name, href: `/racks/${rackRow.id}` }] : []),
			]
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
			setError(t('device.moveInvalid'))
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
			setError(t('device.pickBothPorts'))
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
		noun: 'noun.device',
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
		return types()?.find((type) => type.id === id)?.model ?? String(id)
	}

	async function handleRename(iface: InterfaceJson): Promise<void> {
		setError(null)
		const renamed = window.prompt(t('device.renamePrompt'), iface.name)
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
				name={device()?.name}
				crumbs={trail()}
				loading={device.loading}
				loadingText={t('device.loadingOne')}
				record={device()}
				emptyText={t('device.notFound')}
			>
				<DetailHeader
					name={device()?.name}
					editHref={`/devices/${props.id}/edit`}
					onDelete={handleDelete}
				/>
				<DetailSubtitle>
					{device()?.description || t('common.noDescription')}
				</DetailSubtitle>

				<div class="detail-stats">
					<a class="detail-stat" href="#device-interfaces">
						<span class="detail-stat-value">{ifaceCount()}</span>{' '}
						<span class="detail-stat-label">
							{tp('entity.interface', ifaceCount())}
						</span>
					</a>
					<a class="detail-stat" href="#device-trace">
						<span class="detail-stat-value">{traceCount()}</span>{' '}
						<span class="detail-stat-label">
							{tp('device.traceLink', traceCount())}
						</span>
					</a>
					<a class="detail-stat" href="#device-cables">
						<span class="detail-stat-value">{cableCount()}</span>{' '}
						<span class="detail-stat-label">{tp('device.cable', cableCount())}</span>
					</a>
				</div>

				<DetailCard label={t('device.details')}>
					<dt>{t('common.type')}</dt>
					<dd>{typeNameOf(device()?.device_type_id)}</dd>
					<dt>{t('common.description')}</dt>
					<dd>{device()?.description || '—'}</dd>
					<dt>{t('device.serial')}</dt>
					<dd>{device()?.serial ?? '—'}</dd>
					<dt>{tp('entity.tenant', 1)}</dt>
					<dd>
						<ForeignKeyLink
							id={tenantId()}
							loading={tenant.loading}
							name={tenant()?.name}
							href={`/tenants/${tenantId() ?? ''}`}
						/>
					</dd>
					<dt>{tp('entity.site', 1)}</dt>
					<dd>
						<ForeignKeyLink
							id={siteId()}
							loading={site.loading}
							name={site()?.name}
							href={`/sites/${siteId() ?? ''}`}
						/>
					</dd>
					<dt>{tp('entity.location', 1)}</dt>
					<dd>
						<ForeignKeyLink
							id={locationId()}
							loading={locationName.loading}
							name={locationName()}
						/>
					</dd>
					<dt>{tp('entity.rack', 1)}</dt>
					<dd>
						<ForeignKeyLink
							id={rackId()}
							loading={rack.loading}
							name={rack()?.name}
							href={`/racks/${rackId() ?? ''}`}
						/>
					</dd>
					<dt>{t('shelf.face')}</dt>
					<dd>{faceLabelOrDash(device()?.face)}</dd>
					<dt>{t('common.position')}</dt>
					<dd>
						{device()?.position_u !== null && device()?.position_u !== undefined ? (
							<code>
								{t('common.unitPosition', { u: device()?.position_u ?? '' })}
							</code>
						) : shelfId() !== null ? (
							<ForeignKeyLink
								id={shelfId()}
								loading={shelf.loading}
								name={t('device.onShelf', {
									name:
										shelf()?.name ||
										t('common.unitPosition', { u: shelf()?.position_u ?? '' }),
								})}
								href={`/shelves/${shelfId() ?? ''}/edit`}
							/>
						) : (
							<span>{t('device.unracked')}</span>
						)}
					</dd>
				</DetailCard>
			</DetailShell>
			<h3>{t('device.move')}</h3>
			<form onSubmit={handleMove}>
				<input
					placeholder={t('device.movePlaceholder')}
					inputmode="numeric"
					value={moveU()}
					onInput={(e: InputEventAndTarget) => setMoveU(e.currentTarget.value)}
				/>
				<button type="submit">{t('device.move')}</button>
			</form>
			<h3 id="device-interfaces">
				{t('device.interfacesCount', { count: ifaces()?.length ?? 0 })}
			</h3>
			<form onSubmit={handleAddIface}>
				<input
					placeholder={t('device.interfaceNamePlaceholder')}
					value={ifaceName()}
					onInput={(e: InputEventAndTarget) => setIfaceName(e.currentTarget.value)}
				/>
				<button type="submit">{t('device.addInterface')}</button>
			</form>
			<DataTable
				rows={() => ifaces() ?? []}
				getRowId={(iface: InterfaceJson): number => iface.id}
				showColumnCustomizer
				columns={[
					{
						key: 'status',
						label: t('common.status'),
						getValue: (iface: InterfaceJson): JSX.Element => (
							<span
								title={iface.connected ? t('device.connected') : t('device.free')}
							>
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
						label: t('common.name'),
						getValue: (iface: InterfaceJson): JSX.Element => <code>{iface.name}</code>,
					},
					{
						key: 'kind',
						label: t('device.kind'),
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
									? t('device.alreadyConnected')
									: t('device.connectToPeer', { name: iface.name })
							}
							aria-label={t('device.connectCableFor', { name: iface.name })}
							onClick={() => handleConnectCable(iface)}
						>
							<IconLinkPlus size={20} />
						</button>
						<button type="button" onClick={() => handleRename(iface)}>
							{t('device.rename')}
						</button>
					</span>
				)}
				empty={false}
			/>
			<h3 id="device-connect">{t('device.connectCable')}</h3>
			<form onSubmit={handleConnect}>
				<select
					value={localIface()}
					onChange={(e: Event & { currentTarget: HTMLSelectElement }) =>
						setLocalIface(e.currentTarget.value)
					}
					aria-label={t('device.localFreePort')}
				>
					<option value="">{t('device.localFreePortPlaceholder')}</option>
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
					aria-label={t('device.peerDevice')}
				>
					<option value="">{t('device.peerDevicePlaceholder')}</option>
					<For each={devices() ?? []}>
						{(d: DeviceRow): JSX.Element => <option value={d.id}>{d.name}</option>}
					</For>
				</select>{' '}
				<select
					value={peerIface()}
					onChange={(e: Event & { currentTarget: HTMLSelectElement }) =>
						setPeerIface(e.currentTarget.value)
					}
					aria-label={t('device.peerFreePort')}
				>
					<option value="">{t('device.peerFreePortPlaceholder')}</option>
					<For each={freePeer()}>
						{(iface: InterfaceJson): JSX.Element => (
							<option value={iface.id}>{iface.name}</option>
						)}
					</For>
				</select>{' '}
				<input
					placeholder={t('device.labelPlaceholder')}
					value={cableLabel()}
					onInput={(e: InputEventAndTarget) => setCableLabel(e.currentTarget.value)}
				/>{' '}
				<button type="submit">{t('device.connect')}</button>
			</form>
			<h3 id="device-trace">
				{t('device.traceCount', { count: trace()?.links.length ?? 0 })}
			</h3>
			<label>
				<span class="visually-hidden">{t('device.traceDepth')}</span>
				<select
					aria-label={t('device.traceDepth')}
					value={traceDepth()}
					onChange={(e: Event & { currentTarget: HTMLSelectElement }) =>
						setTraceDepth(e.currentTarget.value)
					}
				>
					<For each={TRACE_DEPTHS}>
						{(depth: number): JSX.Element => (
							<option value={depth}>{t('device.depth', { count: depth })}</option>
						)}
					</For>
				</select>
			</label>{' '}
			<a href="/topology" onClick={(e: MouseEvent): void => goTo(e, '/topology')}>
				{t('device.openInTopology')}
			</a>
			<Show
				when={(trace()?.links ?? []).length > 0}
				fallback={<Empty message={t('device.noTrace')} />}
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
									{t('device.disconnect')}
								</button>
							</li>
						)}
					</For>
				</ul>
			</Show>
			<Show when={(trace()?.paths ?? []).length > 0}>
				<h4>{t('device.multiHopPaths', { count: trace()?.paths.length ?? 0 })}</h4>
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
										goTo(e, `/devices/${path.end_device.id}`)
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
				{t('device.cablesCount', { count: cables()?.length ?? 0 })}{' '}
				<a
					href={`/connections?device=${props.id}`}
					onClick={(e: MouseEvent): void => goTo(e, `/connections?device=${props.id}`)}
				>
					{t('device.viewAllShort')}
				</a>
			</h3>
			<DataTable
				rows={() => cables() ?? []}
				getRowId={(cable: CableRow): number => cable.id}
				showColumnCustomizer
				columns={[
					{
						key: 'label',
						label: t('device.label'),
						getValue: (cable: CableRow): string => cable.label ?? '—',
					},
					{
						key: 'status',
						label: t('common.status'),
						getValue: (cable: CableRow): JSX.Element => (
							<span class="badge">{cableStatusLabel(cable.status)}</span>
						),
					},
					{
						key: 'kind',
						label: t('device.kind'),
						getValue: (cable: CableRow): string => cable.kind ?? '—',
					},
				]}
				rowActions={(cable: CableRow): JSX.Element => (
					<button
						type="button"
						class="btn-danger"
						onClick={() => handleDisconnect(cable.id)}
					>
						{t('device.disconnect')}
					</button>
				)}
				emptyContent={<Empty message={t('device.noCables')} />}
			/>
			<InlineError message={error()} />
		</div>
	)
}
