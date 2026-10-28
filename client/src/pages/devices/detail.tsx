import { IconArrowsExchange, IconLinkPlus, IconPencil, IconUnlink } from '@tabler/icons-solidjs'
import { OTHER_PORT_KINDS } from 'shared/src/ports'
import type { TraceEndToEnd, TraceLink } from 'shared/src/types'
import { type Accessor, createMemo, createResource, createSignal, type JSX, Show } from 'solid-js'
import { Dynamic } from 'solid-js/web'
import { fetch_outlets } from '../../api/attachments'
import { delete_cable, fetch_trace } from '../../api/cables'
import { fetch_device_role } from '../../api/device_roles'
import {
	type DeviceListItem,
	type DeviceRow,
	delete_device,
	fetch_device,
	fetch_device_list,
	fetch_device_service,
	fetch_interfaces,
	type InterfaceJson,
} from '../../api/devices'
import { fetch_employee } from '../../api/employees'
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
	RelatedSection,
	useDetailDelete,
} from '../../components/detail_page'
import { InlineError } from '../../components/feedback'
import { FloorplanLinks, OutletLinks } from '../../components/floorplan_links'
import { IconLabel } from '../../components/icon_label'
import { t, tp } from '../../i18n'
import { deviceRoleLabel, faceLabel, portKindLabel } from '../../i18n/labels'
import { deviceRoleIcon, panelKindIcon } from '../../lib/icons'
import { createRecord, createRowsFor, useAction } from '../../lib/resource'
import { type Crumb, navigate } from '../../lib/router'
import { can, canGlobal } from '../../lib/session'
import { siteTrail } from '../../lib/trails'
import { ManagedServicePill } from '../managed-bundles/service_pill'
import { ConnectPortDialog } from './connect_port_dialog'
import { EditPortDialog } from './edit_port_dialog'
import { MoveTenantDialog } from './move_tenant_dialog'
import { useOutletLocationOptions } from './outlet_location'
import { PanelPortTable, type PanelRow } from './panel_ports'
import { PanelRowDialog } from './panel_row_dialog'
import { PortPeer } from './trace_peer'

/**
 * General, power, outlet and display ports; everything else is a network
 * port. Patch-panel ports (with a side) are neither.
 */
const isOtherPort = (iface: InterfaceJson): boolean =>
	!iface.side && OTHER_PORT_KINDS.has(iface.kind)
const isPanelPort = (iface: InterfaceJson): boolean => iface.side !== null

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
 * cable connect/disconnect and edit dialogs, and the virtual machines the
 * device hosts.
 */
export function DeviceDetailPage(props: { id: number }): JSX.Element {
	const [error, setError] = createSignal<string | null>(null)
	const [connectingIface, setConnectingIface] = createSignal<InterfaceJson | null>(null)
	const [editingIface, setEditingIface] = createSignal<InterfaceJson | null>(null)
	const [editingRow, setEditingRow] = createSignal<PanelRow | null>(null)
	const [movingTenant, setMovingTenant] = createSignal(false)
	const id = (): number => props.id

	const [device, { refetch: refetchDevice }] = createRecord(id, fetch_device, setError)
	const [ifaces, { refetch: refetchIfaces }] = createRowsFor(id, fetch_interfaces, setError)
	const [vms] = createRowsFor(
		id,
		(key: number) => fetch_device_list({ host: key, kind: 'vm' }),
		setError,
	)
	const [trace, { refetch: refetchTrace }] = createRecord(
		id,
		(key: number) => fetch_trace(key, 4),
		setError,
	)
	const [outlets, { refetch: refetchOutlets }] = createRowsFor(id, fetch_outlets, setError)
	const typeId = (): number | undefined => device()?.device_type_id
	const roleId = (): number | undefined => device()?.device_role_id
	const siteId = (): number | null | undefined => device()?.site_id
	const locationId = (): number | null | undefined => device()?.location_id
	const rackId = (): number | null | undefined => device()?.rack_id
	const shelfId = (): number | null | undefined => device()?.shelf_id
	const tenantId = (): number | null | undefined => device()?.tenant_id
	const employeeId = (): number | null | undefined => device()?.employee_id
	const [deviceType] = createRecord(typeId, fetch_device_type)
	const [deviceRole] = createRecord(roleId, fetch_device_role, setError)
	const [site] = createRecord(siteId, fetch_site, setError)
	const [location] = createRecord(locationId, fetch_location, setError)
	const [rack] = createRecord(rackId, fetch_rack, setError)
	const [shelf] = createRecord(shelfId, fetch_shelf, setError)
	const [tenant] = createRecord(tenantId, fetch_tenant, setError)
	const [employee] = createRecord(employeeId, fetch_employee, setError)
	// Keyed on the record so a role or tenant change refetches the SLA.
	const [service] = createRecord(
		() => device(),
		(row: DeviceRow) => fetch_device_service(row.id),
		setError,
	)
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
		void refetchOutlets()
	}

	const action = useAction(setError)

	async function handleDisconnect(cableId: number): Promise<void> {
		if (await action.run(() => delete_cable(cableId))) {
			refetchAll()
		}
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

	const networkPorts = createMemo(() =>
		(ifaces() ?? []).filter((i) => !isOtherPort(i) && !isPanelPort(i)),
	)
	const panelPorts = createMemo(() => (ifaces() ?? []).filter(isPanelPort))
	const locationOptions = useOutletLocationOptions(tenantId, setError)
	const locationLabels = createMemo(
		() => new Map(locationOptions().map((option) => [Number(option.value), option.label])),
	)
	/** Current state of a port of the row being edited (its cable may change meanwhile). */
	const currentIface = (iface: InterfaceJson | null): InterfaceJson | null =>
		iface && ((ifaces() ?? []).find((i) => i.id === iface.id) ?? iface)
	const otherPorts = createMemo(() => (ifaces() ?? []).filter(isOtherPort))
	/** 1-based network port number: position in creation order (eth1..ethN). */
	const portNumbers = createMemo(
		() => new Map(networkPorts().map((iface, index) => [iface.id, index + 1])),
	)
	/** Direct cable peer per local interface, from the trace links. */
	const linksByIface = createMemo(
		() => new Map((trace()?.links ?? []).map((link) => [link.local_interface.id, link])),
	)
	/** End-to-end peers behind patch panels, per local interface. */
	const endToEndByIface = createMemo(() => {
		const byIface = new Map<number, TraceEndToEnd[]>()
		for (const peer of trace()?.end_to_end ?? []) {
			byIface.set(peer.local_interface_id, [
				...(byIface.get(peer.local_interface_id) ?? []),
				peer,
			])
		}
		return byIface
	})
	const endToEndOf = (ifaceId: number): TraceEndToEnd[] => endToEndByIface().get(ifaceId) ?? []

	const nameColumn: DataTableColumn<InterfaceJson> = {
		key: 'name',
		label: t('common.name'),
		getValue: (iface: InterfaceJson): JSX.Element => <code>{iface.name}</code>,
	}
	const connectionColumn: DataTableColumn<InterfaceJson> = {
		key: 'connection',
		label: t('device.connection'),
		getValue: (iface: InterfaceJson): JSX.Element => (
			<PortPeer link={linksByIface().get(iface.id)} endToEnd={endToEndOf(iface.id)} />
		),
	}
	/** Network ports get the enabled state and port number. */
	const networkColumns: DataTableColumn<InterfaceJson>[] = [
		{
			key: 'enabled',
			label: t('device.enabled'),
			getValue: (iface: InterfaceJson): JSX.Element => (
				<span class="badge" classList={{ 'badge-active': iface.enabled }}>
					{iface.enabled ? t('device.enabled') : t('device.disabled')}
				</span>
			),
		},
		{
			key: 'port',
			label: t('device.portNumber'),
			getValue: (iface: InterfaceJson): JSX.Element => (
				<span classList={{ 'text-muted': !iface.enabled }}>
					{portNumbers().get(iface.id) ?? '—'}
				</span>
			),
		},
		{
			...nameColumn,
			getValue: (iface: InterfaceJson): JSX.Element => (
				<code classList={{ 'text-muted': !iface.enabled }}>{iface.name}</code>
			),
		},
		connectionColumn,
	]
	/** Other ports show their kind instead. */
	const otherColumns: DataTableColumn<InterfaceJson>[] = [
		nameColumn,
		{
			key: 'kind',
			label: t('device.kind'),
			getValue: (iface: InterfaceJson): string => portKindLabel(iface.kind),
		},
		connectionColumn,
	]

	/** Floor plan an outlet (single-position rear port) is placed on. */
	const planColumn: DataTableColumn<PanelRow> = {
		key: 'plan',
		label: tp('entity.floorplan', 1),
		getValue: (row: PanelRow): JSX.Element => {
			const outlet =
				row.position === null
					? (outlets() ?? []).find((o) => o.interface_id === row.rear.id)
					: undefined
			return outlet ? (
				<a href={`/floorplans/${outlet.attachment_id}`}>{outlet.owner_name}</a>
			) : (
				<span>—</span>
			)
		},
	}

	/** Room an outlet's installation cable ends in. */
	const locationColumn: DataTableColumn<PanelRow> = {
		key: 'location',
		label: t('device.panel.location'),
		getValue: (row: PanelRow): JSX.Element => {
			const locationKey = row.position === null ? row.rear.location_id : null
			return locationKey === null ? (
				<span>—</span>
			) : (
				<a href={`/locations/${locationKey}`}>
					{locationLabels().get(locationKey) ?? `#${locationKey}`}
				</a>
			)
		},
	}

	const portActions = (iface: InterfaceJson): JSX.Element => (
		<PortActions
			iface={iface}
			link={linksByIface().get(iface.id)}
			onConnect={(): void => openDialog(setConnectingIface, iface)}
			onDisconnect={(cableId: number): void => void handleDisconnect(cableId)}
			onEdit={(): void => openDialog(setEditingIface, iface)}
		/>
	)

	const panelRowActions = (row: PanelRow): JSX.Element => {
		const name = (): string =>
			[row.front?.name, row.position === null ? row.rear.name : null]
				.filter(Boolean)
				.join(' / ')
		return (
			<button
				type="button"
				class="icon-btn panel-row-edit"
				title={t('device.panel.editRow', { name: name() })}
				aria-label={t('device.panel.editRow', { name: name() })}
				onClick={(): void => {
					setError(null)
					setEditingRow(row)
				}}
			>
				<IconPencil size={20} />
			</button>
		)
	}

	const portTable = (
		rows: () => InterfaceJson[],
		columns: DataTableColumn<InterfaceJson>[],
	): JSX.Element => (
		<DataTable
			rows={rows}
			getRowId={(iface: InterfaceJson): number => iface.id}
			showColumnCustomizer
			columns={columns}
			rowActions={can('edit') ? portActions : undefined}
			empty={false}
		/>
	)

	const shelfLabel = (): string =>
		t('device.onShelf', {
			name: shelf()?.name || t('common.unitPosition', { u: shelf()?.position_u ?? '' }),
		})

	/** Where in the rack the device sits: U and face, or its shelf (hidden when unracked). */
	function Mount(): JSX.Element {
		return (
			<Show when={device()?.position_u != null || shelfId() != null}>
				{' ('}
				<Show
					when={device()?.position_u != null}
					fallback={
						<ForeignKeyLink
							id={shelfId()}
							loading={shelf.loading}
							name={shelfLabel()}
							href={`/shelves/${shelfId() ?? ''}/edit`}
						/>
					}
				>
					{t('common.unitPosition', { u: device()?.position_u ?? '' })}
					{' / '}
					{device()?.face ? faceLabel(device()?.face ?? '') : '—'}
				</Show>
				{')'}
			</Show>
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
					cloneHref={`/devices/add?clone=${props.id}`}
					onDelete={handleDelete}
					actions={
						<Show when={canGlobal('edit')}>
							<button type="button" onClick={() => setMovingTenant(true)}>
								<IconLabel icon={IconArrowsExchange}>
									{t('device.moveTenant')}
								</IconLabel>
							</button>
						</Show>
					}
				/>
				<DetailSubtitle description={device()?.description} />
				<ManagedServicePill service={service} />

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
					<dt>{tp('entity.deviceRole', 1)}</dt>
					<dd>
						<IconLabel icon={deviceRoleIcon(deviceRole()?.icon)}>
							<ForeignKeyLink
								id={roleId()}
								loading={deviceRole.loading}
								name={deviceRoleLabel(deviceRole())}
								href={`/device-roles/${roleId() ?? ''}`}
							/>
						</IconLabel>
					</dd>
					<dt>{t('device.serial')}</dt>
					<dd>{device()?.serial ?? '—'}</dd>
					<dt>{t('device.deviceId')}</dt>
					<dd>{device()?.device_id ?? '—'}</dd>
					<dt>{tp('entity.tenant', 1)}</dt>
					<dd>
						<RecordLink id={tenantId()} record={tenant} base="/tenants" />
					</dd>
					<dt>{t('device.assignedEmployee')}</dt>
					<dd>
						<RecordLink id={employeeId()} record={employee} base="/employees" />
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
					<FloorplanLinks
						target={{ device: props.id }}
						label="floorplan.onPlanOf"
						onError={setError}
					/>
					<Show when={panelPorts().length === 0}>
						<OutletLinks
							outlets={outlets() ?? []}
							portName={(ifaceId: number) =>
								(ifaces() ?? []).find((i) => i.id === ifaceId)?.name
							}
						/>
					</Show>
				</DetailCard>
			</DetailShell>
			<Show when={panelPorts().length > 0}>
				<h3 id="device-panel-ports" class="panel-ports-heading">
					<span>
						{t('device.panelPortsCount', {
							count: panelPorts().filter((p) => p.side === 'rear').length,
						})}
					</span>
					<Show when={panelPorts()[0]?.kind}>
						{(kind: Accessor<string>) => (
							<span aria-hidden="true" class="app-nav-icon">
								<Dynamic component={panelKindIcon(kind())} size={18} />
							</span>
						)}
					</Show>
				</h3>
				<PanelPortTable
					ports={panelPorts()}
					links={linksByIface()}
					endToEnd={endToEndOf}
					onConnect={
						can('edit')
							? (iface: InterfaceJson): void => openDialog(setConnectingIface, iface)
							: undefined
					}
					rowActions={can('edit') ? panelRowActions : undefined}
					extraColumns={[locationColumn, planColumn]}
				/>
			</Show>
			<Show when={networkPorts().length > 0 || panelPorts().length === 0}>
				<h3 id="device-interfaces">
					{t('device.networkPortsCount', { count: networkPorts().length })}
				</h3>
				{portTable(networkPorts, networkColumns)}
			</Show>
			<Show when={otherPorts().length > 0}>
				<h3 id="device-other-ports">
					{t('device.otherPortsCount', { count: otherPorts().length })}
				</h3>
				{portTable(otherPorts, otherColumns)}
			</Show>
			<Show when={deviceRole()?.can_host_vms === 1}>
				<RelatedSection
					id="device-vms"
					title={tp('entity.virtualMachine', 2)}
					noun="noun.virtualMachine"
					rows={vms}
					emptyText={t('vm.emptyOnHost')}
					actions={
						<Show when={can('edit')}>
							<button
								type="button"
								onClick={() => navigate(`/devices/vm/add?host=${props.id}`)}
							>
								{t('vm.addVm')}
							</button>
						</Show>
					}
					columns={[
						{
							key: 'name',
							label: t('common.name'),
							getValue: (vm: DeviceListItem): JSX.Element => (
								<a href={`/devices/vm/${vm.id}`}>{vm.name}</a>
							),
						},
						{
							key: 'description',
							label: t('common.description'),
							getValue: (vm: DeviceListItem): string => vm.description || '—',
						},
					]}
				/>
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
			<Show when={editingRow()} keyed>
				{(row: PanelRow): JSX.Element => (
					<PanelRowDialog
						device_id={props.id}
						rear={row.position === null ? currentIface(row.rear) : null}
						front={currentIface(row.front)}
						links={linksByIface()}
						endToEnd={endToEndOf}
						location_options={locationOptions()}
						on_changed={refetchAll}
						on_saved={() => {
							setEditingRow(null)
							refetchAll()
						}}
						on_close={() => setEditingRow(null)}
					/>
				)}
			</Show>
			<Show when={movingTenant() ? device() : undefined}>
				{(row: () => DeviceRow): JSX.Element => (
					<MoveTenantDialog
						row={{ kind: 'device', ...row() }}
						on_moved={() => {
							setMovingTenant(false)
							void refetchDevice()
						}}
						on_close={() => setMovingTenant(false)}
					/>
				)}
			</Show>
			<InlineError message={error()} />
		</div>
	)
}
