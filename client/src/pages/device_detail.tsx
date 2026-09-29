import { IconLinkPlus, IconPencil, IconUnlink } from '@tabler/icons-solidjs'
import { Result } from 'better-result'
import type { TraceLink } from 'shared/src/types'
import type { JSX } from 'solid-js'
import { createMemo, createResource, createSignal, Show } from 'solid-js'
import { delete_cable, fetch_trace } from '../api_cables'
import { delete_device, fetch_device, fetch_interfaces, type InterfaceJson } from '../api_devices'
import { fetch_rack } from '../api_racks'
import { fetch_shelf } from '../api_shelves'
import { fetch_device_types } from '../api_templates'
import { fetch_locations, fetch_site, fetch_tenant } from '../api_tenancy'
import { ConnectPortDialog, OTHER_PORT_KINDS } from '../components/connect_port_dialog'
import { DataTable } from '../components/data_table'
import {
	DetailCard,
	DetailHeader,
	DetailShell,
	DetailSubtitle,
	ForeignKeyLink,
	InlineError,
	useDetailDelete,
} from '../components/detail_page'
import { EditPortDialog } from '../components/edit_port_dialog'
import { t, tp } from '../i18n'
import { faceLabel } from '../i18n/labels'
import { type Crumb, goTo } from '../router'
import { canWrite } from '../session'
import { locationTrail } from '../trails'

/**
 * /devices/:id — detail with network and other interfaces, plus the per-port
 * cable connect/disconnect and edit dialogs.
 */
export function DeviceDetailPage(props: { id: number }): JSX.Element {
	const [error, setError] = createSignal<string | null>(null)
	const [connectingIface, setConnectingIface] = createSignal<InterfaceJson | null>(null)
	const [editingIface, setEditingIface] = createSignal<InterfaceJson | null>(null)

	const [device] = createResource(async () => {
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
		const res = await fetch_trace(props.id, 4)
		if (Result.isError(res)) {
			setError(res.error.message)
			return null
		}
		return res.value
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
	function refetchAll(): void {
		void refetchIfaces()
		void refetchTrace()
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

	function handleConnectCable(iface: InterfaceJson): void {
		setError(null)
		setConnectingIface(iface)
	}

	function handleEdit(iface: InterfaceJson): void {
		setError(null)
		setEditingIface(iface)
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
				rowActions={
					canWrite()
						? (iface: InterfaceJson): JSX.Element => {
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
													title={t('device.connectToPeer', {
														name: iface.name,
													})}
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
													class="icon-btn icon-btn-danger"
													title={t('device.disconnectPort', {
														name: iface.name,
													})}
													aria-label={t('device.disconnectPort', {
														name: iface.name,
													})}
													onClick={() => handleDisconnect(l().cable_id)}
												>
													<IconUnlink size={20} />
												</button>
											)}
										</Show>
										<button
											type="button"
											class="icon-btn"
											title={t('device.editPort', { name: iface.name })}
											aria-label={t('device.editPort', { name: iface.name })}
											onClick={() => handleEdit(iface)}
										>
											<IconPencil size={20} />
										</button>
									</span>
								)
							}
						: undefined
				}
				empty={false}
			/>
		)
	}

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
			<Show when={connectingIface()}>
				{(iface: () => InterfaceJson): JSX.Element => (
					<ConnectPortDialog
						iface={iface()}
						on_connected={() => {
							setConnectingIface(null)
							refetchAll()
						}}
						on_close={() => setConnectingIface(null)}
					/>
				)}
			</Show>
			<Show when={editingIface()}>
				{(iface: () => InterfaceJson): JSX.Element => (
					<EditPortDialog
						device_id={props.id}
						iface={iface()}
						show_enabled={!isOtherPort(iface())}
						on_saved={() => {
							setEditingIface(null)
							void refetchIfaces()
						}}
						on_close={() => setEditingIface(null)}
					/>
				)}
			</Show>
			<InlineError message={error()} />
		</div>
	)
}
