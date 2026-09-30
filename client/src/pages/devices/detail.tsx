import { IconLinkPlus, IconPencil, IconUnlink } from '@tabler/icons-solidjs'
import { Result } from 'better-result'
import type { TraceLink } from 'shared/src/types'
import { createMemo, createResource, createSignal, type JSX, Show } from 'solid-js'
import { delete_cable, fetch_trace } from '../../api/cables'
import {
	delete_device,
	fetch_device,
	fetch_interfaces,
	type InterfaceJson,
} from '../../api/devices'
import { fetch_rack } from '../../api/racks'
import { fetch_shelf } from '../../api/shelves'
import { fetch_device_type } from '../../api/templates'
import { fetch_location, fetch_site, fetch_tenant } from '../../api/tenancy'
import { DataTable, type DataTableColumn } from '../../components/data_table'
import {
	DetailCard,
	DetailHeader,
	DetailShell,
	DetailSubtitle,
	ForeignKeyLink,
	RecordLink,
	useDetailDelete,
} from '../../components/detail_page'
import { InlineError } from '../../components/feedback'
import { t, tp } from '../../i18n'
import { faceLabel } from '../../i18n/labels'
import { createRecord, createRowsFor } from '../../lib/resource'
import type { Crumb } from '../../lib/router'
import { canWrite } from '../../lib/session'
import { siteTrail } from '../../lib/trails'
import { ConnectPortDialog, OTHER_PORT_KINDS } from './connect_port_dialog'
import { EditPortDialog } from './edit_port_dialog'

/** Console and power ports; everything else is a network port. */
const isOtherPort = (iface: InterfaceJson): boolean => OTHER_PORT_KINDS.has(iface.kind)

/** Connect or disconnect plus edit buttons of one port row. */
function PortActions(props: {
	iface: InterfaceJson
	link: TraceLink | undefined
	onConnect: () => void
	onDisconnect: (cableId: number) => void
	onEdit: () => void
}): JSX.Element {
	const name = (): string => props.iface.name
	return (
		<span class="row-actions">
			<Show
				when={props.link}
				fallback={
					<button
						type="button"
						class="icon-btn icon-btn-connect"
						disabled={props.iface.connected}
						title={t('device.connectToPeer', { name: name() })}
						aria-label={t('device.connectCableFor', { name: name() })}
						onClick={props.onConnect}
					>
						<IconLinkPlus size={20} />
					</button>
				}
			>
				{(link: () => TraceLink): JSX.Element => (
					<button
						type="button"
						class="icon-btn icon-btn-danger"
						title={t('device.disconnectPort', { name: name() })}
						aria-label={t('device.disconnectPort', { name: name() })}
						onClick={() => props.onDisconnect(link().cable_id)}
					>
						<IconUnlink size={20} />
					</button>
				)}
			</Show>
			<button
				type="button"
				class="icon-btn"
				title={t('device.editPort', { name: name() })}
				aria-label={t('device.editPort', { name: name() })}
				onClick={props.onEdit}
			>
				<IconPencil size={20} />
			</button>
		</span>
	)
}

/**
 * /devices/:id — detail with network and other interfaces, plus the per-port
 * cable connect/disconnect and edit dialogs.
 */
export function DeviceDetailPage(props: { id: number }): JSX.Element {
	const [error, setError] = createSignal<string | null>(null)
	const [connectingIface, setConnectingIface] = createSignal<InterfaceJson | null>(null)
	const [editingIface, setEditingIface] = createSignal<InterfaceJson | null>(null)
	const id = (): number => props.id

	const [device] = createRecord(id, fetch_device, setError)
	const [ifaces, { refetch: refetchIfaces }] = createRowsFor(id, fetch_interfaces, setError)
	const [trace, { refetch: refetchTrace }] = createRecord(
		id,
		(key: number) => fetch_trace(key, 4),
		setError,
	)
	const typeId = (): number | undefined => device()?.device_type_id
	const siteId = (): number | null | undefined => device()?.site_id
	const locationId = (): number | null | undefined => device()?.location_id
	const rackId = (): number | null | undefined => device()?.rack_id
	const shelfId = (): number | null | undefined => device()?.shelf_id
	const tenantId = (): number | null | undefined => device()?.tenant_id
	const [deviceType] = createRecord(typeId, fetch_device_type)
	const [site] = createRecord(siteId, fetch_site, setError)
	const [location] = createRecord(locationId, fetch_location, setError)
	const [rack] = createRecord(rackId, fetch_rack, setError)
	const [shelf] = createRecord(shelfId, fetch_shelf, setError)
	const [tenant] = createRecord(tenantId, fetch_tenant, setError)
	const [trail] = createResource(
		() => ({ site: site(), location: locationId() ?? null, rack: rack() }),
		async ({ site: siteRow, location: locationKey, rack: rackRow }): Promise<Crumb[]> => [
			...(await siteTrail(siteRow, locationKey)),
			...(rackRow ? [{ label: rackRow.name, href: `/racks/${rackRow.id}` }] : []),
		],
	)

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

	const handleDelete = useDetailDelete({
		noun: 'noun.device',
		name: () => device()?.name,
		id: props.id,
		remove: delete_device,
		setError,
		listRoute: '/devices',
	})

	function openDialog(open: (iface: InterfaceJson) => void, iface: InterfaceJson): void {
		setError(null)
		open(iface)
	}

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

	const nameColumn: DataTableColumn<InterfaceJson> = {
		key: 'name',
		label: t('common.name'),
		getValue: (iface: InterfaceJson): JSX.Element => <code>{iface.name}</code>,
	}
	const connectionColumn: DataTableColumn<InterfaceJson> = {
		key: 'connection',
		label: t('device.connection'),
		getValue: (iface: InterfaceJson): JSX.Element => {
			const link = linksByIface().get(iface.id)
			if (!link) {
				return <span>—</span>
			}
			return (
				<span>
					<a href={`/devices/${link.peer_device.id}`}>{link.peer_device.name}</a>:{' '}
					<code>{link.peer_interface.name}</code>
				</span>
			)
		},
	}
	/** Network ports get the enabled state and port number. */
	const networkColumns: DataTableColumn<InterfaceJson>[] = [
		{
			key: 'enabled',
			label: t('device.enabled'),
			getValue: (iface: InterfaceJson): string =>
				iface.enabled ? t('common.yes') : t('common.no'),
		},
		{
			key: 'port',
			label: t('device.portNumber'),
			getValue: (iface: InterfaceJson): string => String(portNumbers().get(iface.id) ?? '—'),
		},
		nameColumn,
		connectionColumn,
	]
	/** Console/power ports show their kind instead. */
	const otherColumns: DataTableColumn<InterfaceJson>[] = [
		nameColumn,
		{
			key: 'kind',
			label: t('device.kind'),
			getValue: (iface: InterfaceJson): string => iface.kind,
		},
		connectionColumn,
	]

	const portActions = (iface: InterfaceJson): JSX.Element => (
		<PortActions
			iface={iface}
			link={linksByIface().get(iface.id)}
			onConnect={(): void => openDialog(setConnectingIface, iface)}
			onDisconnect={(cableId: number): void => void handleDisconnect(cableId)}
			onEdit={(): void => openDialog(setEditingIface, iface)}
		/>
	)

	const portTable = (
		rows: () => InterfaceJson[],
		columns: DataTableColumn<InterfaceJson>[],
	): JSX.Element => (
		<DataTable
			rows={rows}
			getRowId={(iface: InterfaceJson): number => iface.id}
			showColumnCustomizer
			columns={columns}
			rowActions={canWrite() ? portActions : undefined}
			empty={false}
		/>
	)

	const shelfLabel = (): string =>
		t('device.onShelf', {
			name: shelf()?.name || t('common.unitPosition', { u: shelf()?.position_u ?? '' }),
		})

	/** Where in the rack the device sits: U and face, its shelf, or `—`. */
	function Mount(): JSX.Element {
		const position = (): number | null | undefined => device()?.position_u
		return (
			<>
				{' ('}
				<Show
					when={position() !== null && position() !== undefined}
					fallback={
						<Show when={shelfId()} fallback={<span>—</span>}>
							<ForeignKeyLink
								id={shelfId()}
								loading={shelf.loading}
								name={shelfLabel()}
								href={`/shelves/${shelfId() ?? ''}/edit`}
							/>
						</Show>
					}
				>
					{t('common.unitPosition', { u: position() ?? '' })}
					{' / '}
					{device()?.face ? faceLabel(device()?.face ?? '') : '—'}
				</Show>
				{')'}
			</>
		)
	}

	return (
		<div>
			<DetailShell
				name={device()?.name}
				crumbs={trail()}
				record={device}
				loadingText={t('device.loadingOne')}
				emptyText={t('device.notFound')}
			>
				<DetailHeader
					name={device()?.name}
					editHref={`/devices/${props.id}/edit`}
					onDelete={handleDelete}
				/>
				<DetailSubtitle description={device()?.description} />

				<DetailCard label={t('device.details')}>
					<dt>{t('common.type')}</dt>
					<dd>
						<ForeignKeyLink
							id={typeId()}
							loading={deviceType.loading}
							name={deviceType()?.model}
							href={`/device-types/${typeId() ?? ''}`}
						/>
					</dd>
					<dt>{t('device.serial')}</dt>
					<dd>{device()?.serial ?? '—'}</dd>
					<dt>{tp('entity.tenant', 1)}</dt>
					<dd>
						<RecordLink id={tenantId()} record={tenant} base="/tenants" />
					</dd>
					<dt>{tp('entity.site', 1)}</dt>
					<dd>
						<RecordLink id={siteId()} record={site} base="/sites" />
					</dd>
					<dt>{tp('entity.location', 1)}</dt>
					<dd>
						<RecordLink id={locationId()} record={location} base="/locations" />
					</dd>
					<dt>{tp('entity.rack', 1)}</dt>
					<dd>
						<RecordLink id={rackId()} record={rack} base="/racks" />
						<Mount />
					</dd>
				</DetailCard>
			</DetailShell>
			<h3 id="device-interfaces">
				{t('device.networkPortsCount', { count: networkPorts().length })}
			</h3>
			{portTable(networkPorts, networkColumns)}
			<Show when={otherPorts().length > 0}>
				<h3 id="device-other-ports">
					{t('device.otherPortsCount', { count: otherPorts().length })}
				</h3>
				{portTable(otherPorts, otherColumns)}
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
