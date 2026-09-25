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

/** Interface kinds listed under "other ports" instead of network ports. */
const OTHER_PORT_KINDS = new Set(['console', 'power'])

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

	async function handleToggleEnabled(iface: InterfaceJson): Promise<void> {
		setError(null)
		const res = await update_interface(props.id, iface.id, { enabled: !iface.enabled })
		if (Result.isError(res)) {
			setError(res.error.message)
			return
		}
		void refetchIfaces()
	}

	/** Console and power ports; everything else is a network port. */
	const isOtherPort = (iface: InterfaceJson): boolean => OTHER_PORT_KINDS.has(iface.kind)
	const networkPorts = createMemo(() => (ifaces() ?? []).filter((i) => !isOtherPort(i)))
	const otherPorts = createMemo(() => (ifaces() ?? []).filter(isOtherPort))
	/** 1-based network port number: position in creation order (eth1..ethN). */
	const portNumbers = createMemo(
		() => new Map(networkPorts().map((iface, index) => [iface.id, index + 1])),
	)
	/** Direct cable peer per local interface, from the trace links. */
	const linksByIface = createMemo(
		() => new Map((trace()?.links ?? []).map((link) => [link.local_interface.id, link])),
	)

	/**
	 * Port table; network ports get the enabled state and port number, other
	 * (console/power) ports their kind instead.
	 */
	function portTable(rows: () => InterfaceJson[], other: boolean): JSX.Element {
		return (
			<DataTable
				rows={rows}
				getRowId={(iface: InterfaceJson): number => iface.id}
				showColumnCustomizer
				columns={[
					...(other
						? []
						: [
								{
									key: 'enabled',
									label: t('device.enabled'),
									getValue: (iface: InterfaceJson): string =>
										iface.enabled ? t('common.yes') : t('common.no'),
								},
								{
									key: 'port',
									label: t('device.portNumber'),
									getValue: (iface: InterfaceJson): string =>
										String(portNumbers().get(iface.id) ?? '—'),
								},
							]),
					{
						key: 'name',
						label: t('common.name'),
						getValue: (iface: InterfaceJson): JSX.Element => <code>{iface.name}</code>,
					},
					...(other
						? [
								{
									key: 'kind',
									label: t('device.kind'),
									getValue: (iface: InterfaceJson): string => iface.kind,
								},
							]
						: []),
					{
						key: 'connection',
						label: t('device.connection'),
						getValue: (iface: InterfaceJson): JSX.Element => {
							const link = linksByIface().get(iface.id)
							if (!link) {
								return <span>—</span>
							}
							return (
								<span>
									<a
										href={`/devices/${link.peer_device.id}`}
										onClick={(e: MouseEvent): void =>
											goTo(e, `/devices/${link.peer_device.id}`)
										}
									>
										{link.peer_device.name}
									</a>
									: <code>{link.peer_interface.name}</code>
								</span>
							)
						},
					},
				]}
				rowActions={(iface: InterfaceJson): JSX.Element => {
					const link = linksByIface().get(iface.id)
					return (
						<span class="row-actions">
							<Show
								when={link}
								fallback={
									<button
										type="button"
										class="icon-btn icon-btn-connect"
										disabled={iface.connected}
										title={t('device.connectToPeer', { name: iface.name })}
										aria-label={t('device.connectCableFor', {
											name: iface.name,
										})}
										onClick={() => handleConnectCable(iface)}
									>
										<IconLinkPlus size={20} />
									</button>
								}
							>
								{(l: () => TraceLink): JSX.Element => (
									<button
										type="button"
										class="btn-danger"
										onClick={() => handleDisconnect(l().cable_id)}
									>
										{t('device.disconnect')}
									</button>
								)}
							</Show>
							<Show when={!other}>
								<button type="button" onClick={() => handleToggleEnabled(iface)}>
									{iface.enabled ? t('device.disable') : t('device.enable')}
								</button>
							</Show>
							<button type="button" onClick={() => handleRename(iface)}>
								{t('device.rename')}
							</button>
						</span>
					)
				}}
				empty={false}
			/>
		)
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

				<DetailCard label={t('device.details')}>
					<dt>{t('common.type')}</dt>
					<dd>
						<ForeignKeyLink
							id={device()?.device_type_id ?? null}
							loading={types.loading}
							name={
								types()?.find((type) => type.id === device()?.device_type_id)?.model
							}
							href={`/device-types/${device()?.device_type_id ?? ''}`}
						/>
					</dd>
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
							href={`/locations/${locationId() ?? ''}`}
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
						<Show
							when={
								device()?.position_u !== null && device()?.position_u !== undefined
							}
						>
							{' ('}
							{t('common.unitPosition', { u: device()?.position_u ?? '' })}
							{' / '}
							{device()?.face ? faceLabel(device()?.face ?? '') : '—'}
							{')'}
						</Show>
						<Show when={device()?.position_u == null && shelfId() !== null}>
							{' ('}
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
							{')'}
						</Show>
						<Show when={device()?.position_u == null && shelfId() === null}>
							{' ('}
							<span>{t('device.unracked')}</span>
							{')'}
						</Show>
					</dd>
				</DetailCard>
			</DetailShell>
			<h3 id="device-interfaces">
				{t('device.networkPortsCount', { count: networkPorts().length })}
			</h3>
			{portTable(networkPorts, false)}
			<Show when={otherPorts().length > 0}>
				<h3 id="device-other-ports">
					{t('device.otherPortsCount', { count: otherPorts().length })}
				</h3>
				{portTable(otherPorts, true)}
			</Show>
			<InlineError message={error()} />
		</div>
	)
}
