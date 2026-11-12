import { IconArrowsExchange, IconPencil } from '@tabler/icons-solidjs'
import { OTHER_PORT_KINDS } from 'shared/src/ports'
import type { TraceEndToEnd, TraceLink } from 'shared/src/types'
import { type Accessor, createMemo, createSignal, type JSX, Show } from 'solid-js'
import { Dynamic } from 'solid-js/web'
import { fetch_outlets } from '../../api/attachments'
import { delete_cable, fetch_trace } from '../../api/cables'
import {
	type DeviceDetail,
	type DeviceListItem,
	delete_device,
	fetch_device,
	fetch_device_list,
	fetch_device_service,
	fetch_interfaces,
	fetch_jacks,
	type InterfaceJson,
} from '../../api/devices'
import { type DataTableColumn, nameColumn } from '../../components/data_table'
import {
	DetailHeader,
	DetailShell,
	DetailSubtitle,
	ForeignKeyLink,
	RelatedPreview,
	useDetailDelete,
} from '../../components/detail_page'
import { Empty, InlineError } from '../../components/feedback'
import { FloorplanLinks, OutletLinks } from '../../components/floorplan_links'
import { IconLabel } from '../../components/icon_label'
import { ScrollLink } from '../../components/scroll_link'
import { t, tp } from '../../i18n'
import { deviceRoleLabel, faceLabel } from '../../i18n/labels'
import { floorplanHref } from '../../lib/floorplan_link'
import { deviceRoleIcon, panelKindIcon } from '../../lib/icons'
import { createDerived, createRecord, createRowsFor, useAction } from '../../lib/resource'
import { type Crumb, navigate } from '../../lib/router'
import { can, canGlobal } from '../../lib/session'
import { siteTrail } from '../../lib/trails'
import { EolPill } from '../device_types/eol_pill'
import { ManagedServicePill } from '../managed-bundles/service_pill'
import { ConnectPortDialog } from './connect_port_dialog'
import { EditPortDialog } from './edit_port_dialog'
import { JackDialog } from './jack_dialog'
import { MoveTenantDialog } from './move_tenant_dialog'
import { PanelPortTable, type PanelRow } from './panel_ports'
import { PanelRowDialog } from './panel_row_dialog'
import { DevicePortTable } from './port_table'
import { DeviceStatusBadge } from './status'

/** The device's role as `deviceRoleLabel` reads it. */
const roleOf = (
	row: DeviceDetail | null | undefined,
): { name: string; key: string | null } | undefined =>
	row ? { name: row.device_role_name, key: row.device_role_key } : undefined

/**
 * General, power, outlet and display ports have no enabled state; patch-panel
 * ports (with a side) are not one.
 */
const isOtherPort = (iface: InterfaceJson): boolean =>
	!iface.side && OTHER_PORT_KINDS.has(iface.kind)
const isPanelPort = (iface: InterfaceJson): boolean => iface.side !== null

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
	const [managingJacks, setManagingJacks] = createSignal(false)
	const [movingTenant, setMovingTenant] = createSignal(false)
	const id = (): number => props.id

	const [device] = createRecord(id, fetch_device, setError)
	const [ifaces] = createRowsFor(id, fetch_interfaces, setError)
	const [vms] = createRowsFor(
		id,
		(key: number) => fetch_device_list({ host: key, kind: 'vm' }),
		setError,
	)
	const [trace] = createRecord(id, (key: number) => fetch_trace(key, 4), setError)
	const [outlets] = createRowsFor(id, fetch_outlets, setError)
	// Starts with the device; a device write (role, tenant) outdates it in the cache.
	const [service] = createRecord(id, fetch_device_service, setError)
	const typeId = (): number | undefined => device()?.device_type_id
	const roleId = (): number | undefined => device()?.device_role_id
	const siteId = (): number | null | undefined => device()?.site_id
	const locationId = (): number | null | undefined => device()?.location_id
	const rackId = (): number | null | undefined => device()?.rack_id
	const shelfId = (): number | null | undefined => device()?.shelf_id
	const tenantId = (): number | null | undefined => device()?.tenant_id
	const employeeId = (): number | null | undefined => device()?.employee_id
	/** A related row the device names (null when unset or out of scope). */
	const named = (key: number | null, name: string | null): { id: number; name: string } | null =>
		key !== null && name !== null ? { id: key, name } : null
	const trail = createDerived(
		() => {
			const row = device()
			return row
				? {
						site: named(row.site_id, row.site_name),
						location: row.location_id,
						rack: named(row.rack_id, row.rack_name),
					}
				: null
		},
		async ({ site, location, rack }): Promise<Crumb[]> => [
			...(await siteTrail(site, location)),
			...(rack ? [{ label: rack.name, href: `/racks/${rack.id}` }] : []),
		],
	)

	const handleDelete = useDetailDelete({
		noun: 'noun.device',
		name: () => device()?.name,
		id: props.id,
		remove: delete_device,
		setError,
		listRoute: '/devices',
	})

	const cable = useAction(setError)
	/** Removes a port's cable from the table, without a dialog. */
	const disconnect = (link: TraceLink): void => {
		if (!cable.pending()) {
			void cable.run(() => delete_cable(link.cable_id))
		}
	}

	function openDialog(open: (iface: InterfaceJson) => void, iface: InterfaceJson): void {
		setError(null)
		open(iface)
	}

	/** Ports outside the patch-panel table, grouped by class. */
	const ports = createMemo(() => (ifaces() ?? []).filter((i) => !isPanelPort(i)))
	const panelPorts = createMemo(() => (ifaces() ?? []).filter(isPanelPort))
	const [jacks] = createRowsFor(() => panelPorts().length > 0 && props.id, fetch_jacks, setError)
	const jackNames = createMemo(() => new Map((jacks() ?? []).map((jack) => [jack.id, jack.name])))
	/** Current state of a port of the row being edited (its cable may change meanwhile). */
	const currentIface = (iface: InterfaceJson | null): InterfaceJson | null =>
		iface && ((ifaces() ?? []).find((i) => i.id === iface.id) ?? iface)
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
				<a href={floorplanHref(outlet.attachment_id, { interface: outlet.interface_id })}>
					{outlet.owner_name}
				</a>
			) : (
				<span>—</span>
			)
		},
	}

	/** Jack an outlet sits in with other outlets of the panel. */
	const jackColumn: DataTableColumn<PanelRow> = {
		key: 'jack',
		label: t('device.panel.jack'),
		getValue: (row: PanelRow): JSX.Element => {
			const jackId = row.position === null ? row.rear.jack_id : null
			return jackId === null ? (
				<span>—</span>
			) : (
				<span class="badge">{jackNames().get(jackId) ?? `#${jackId}`}</span>
			)
		},
	}

	const portActions = (iface: InterfaceJson): JSX.Element => (
		<button
			type="button"
			class="icon-btn"
			title={t('device.editPort', { name: iface.name })}
			aria-label={t('device.editPort', { name: iface.name })}
			onClick={(): void => openDialog(setEditingIface, iface)}
		>
			<IconPencil size={20} />
		</button>
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

	/** Id of the topmost port section, the target of the port count. */
	const firstPortSection = (): string =>
		panelPorts().length > 0 ? 'device-panel-ports' : 'device-interfaces'

	/** Shelf name or U; undefined when the shelf is out of scope (the link shows its id). */
	const shelfLabel = (): string | undefined => {
		const row = device()
		if (row?.shelf_position_u == null) {
			return undefined
		}
		return t('device.onShelf', {
			name: row.shelf_name || t('common.unitPosition', { u: row.shelf_position_u }),
		})
	}

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
							loading={device.loading}
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

				<section class="spec-sheet" aria-label={t('device.details')}>
					<section>
						<h4>{t('device.section.hardware')}</h4>
						<dl>
							<dt>{t('common.status')}</dt>
							<dd>
								<DeviceStatusBadge status={device()?.status ?? 'active'} />
							</dd>
							<dt>{t('common.type')}</dt>
							<dd>
								<ForeignKeyLink
									id={typeId()}
									loading={device.loading}
									name={device()?.device_type_model}
									href={`/device-types/${typeId() ?? ''}`}
								/>{' '}
								<EolPill date={device()?.device_type_eol_date} />
							</dd>
							<dt>{tp('entity.deviceRole', 1)}</dt>
							<dd>
								<IconLabel icon={deviceRoleIcon(device()?.device_role_icon)}>
									<ForeignKeyLink
										id={roleId()}
										loading={device.loading}
										name={deviceRoleLabel(roleOf(device()))}
										href={`/device-roles/${roleId() ?? ''}`}
									/>
								</IconLabel>
							</dd>
							<dt>{t('device.serial')}</dt>
							<dd>{device()?.serial || '—'}</dd>
							<dt>{t('device.deviceId')}</dt>
							<dd>{device()?.device_id || '—'}</dd>
						</dl>
					</section>
					<section>
						<h4>{t('device.locationSection')}</h4>
						<dl>
							<dt>{tp('entity.site', 1)}</dt>
							<dd>
								<ForeignKeyLink
									id={siteId()}
									loading={device.loading}
									name={device()?.site_name}
									href={`/sites/${siteId() ?? ''}`}
								/>
							</dd>
							<dt>{tp('entity.location', 1)}</dt>
							<dd>
								<ForeignKeyLink
									id={locationId()}
									loading={device.loading}
									name={device()?.location_name}
									href={`/locations/${locationId() ?? ''}`}
								/>
							</dd>
							<dt>{tp('entity.rack', 1)}</dt>
							<dd>
								<ForeignKeyLink
									id={rackId()}
									loading={device.loading}
									name={device()?.rack_name}
									href={`/racks/${rackId() ?? ''}`}
								/>
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
						</dl>
					</section>
					<section>
						<h4>{t('device.assignmentSection')}</h4>
						<dl>
							<dt>{tp('entity.tenant', 1)}</dt>
							<dd>
								<ForeignKeyLink
									id={tenantId()}
									loading={device.loading}
									name={device()?.tenant_name}
									href={`/tenants/${tenantId() ?? ''}`}
								/>
							</dd>
							<dt>{t('device.assignedEmployee')}</dt>
							<dd>
								<ForeignKeyLink
									id={employeeId()}
									loading={device.loading}
									name={device()?.employee_name}
									href={`/employees/${employeeId() ?? ''}`}
								/>
							</dd>
							<dt>{t('device.section.ports')}</dt>
							<dd>
								<ScrollLink target={firstPortSection()}>
									{(ifaces() ?? []).length}
								</ScrollLink>
							</dd>
						</dl>
					</section>
				</section>
			</DetailShell>
			<div class="detail-sections">
				<Show when={panelPorts().length > 0}>
					<section class="component-section flat-table" id="device-panel-ports">
						<div class="card-header">
							<h3 class="panel-ports-heading">
								<Show when={panelPorts()[0]?.kind}>
									{(kind: Accessor<string>) => (
										<span aria-hidden="true" class="app-nav-icon">
											<Dynamic component={panelKindIcon(kind())} size={18} />
										</span>
									)}
								</Show>
								{t('device.panelPorts')}{' '}
								<span class="badge">
									{panelPorts().filter((p) => p.side === 'rear').length}
								</span>
							</h3>
							<Show when={can('edit')}>
								<button
									type="button"
									onClick={() => {
										setError(null)
										setManagingJacks(true)
									}}
								>
									{t('device.panel.manageJacks')}
								</button>
							</Show>
						</div>
						<PanelPortTable
							ports={panelPorts()}
							links={linksByIface()}
							endToEnd={endToEndOf}
							onConnect={
								can('edit')
									? (iface: InterfaceJson): void =>
											openDialog(setConnectingIface, iface)
									: undefined
							}
							onDisconnect={can('edit') ? disconnect : undefined}
							rowActions={can('edit') ? panelRowActions : undefined}
							extraColumns={[jackColumn, planColumn]}
						/>
					</section>
				</Show>
				<Show when={ports().length > 0 || panelPorts().length === 0}>
					<section class="component-section" id="device-interfaces">
						<div class="card-header">
							<h3>
								{t('device.ports')} <span class="badge">{ports().length}</span>
							</h3>
						</div>
						<Show
							when={ports().length > 0}
							fallback={<Empty message={t('device.noPorts')} />}
						>
							<DevicePortTable
								ports={ports()}
								links={linksByIface()}
								endToEnd={endToEndOf}
								onConnect={
									can('edit')
										? (iface: InterfaceJson): void =>
												openDialog(setConnectingIface, iface)
										: undefined
								}
								onDisconnect={can('edit') ? disconnect : undefined}
								actions={can('edit') ? portActions : undefined}
							/>
						</Show>
					</section>
				</Show>
				<Show when={device()?.device_role_can_host_vms === 1}>
					<section class="component-section flat-table" id="device-vms">
						<div class="card-header">
							<h3>
								{tp('entity.virtualMachine', 2)}{' '}
								<span class="badge">{(vms() ?? []).length}</span>
							</h3>
							<Show when={can('edit')}>
								<button
									type="button"
									onClick={() => navigate(`/devices/vm/add?host=${props.id}`)}
								>
									{t('vm.addVm')}
								</button>
							</Show>
						</div>
						<RelatedPreview
							rows={vms() ?? []}
							loading={vms.loading}
							all
							columnLines
							noun="noun.virtualMachine"
							emptyText={t('vm.emptyOnHost')}
							columns={[
								nameColumn<DeviceListItem>(t('common.name'), '/devices/vm'),
								{
									key: 'description',
									label: t('common.description'),
									getValue: (vm: DeviceListItem): string => vm.description || '—',
								},
							]}
						/>
					</section>
				</Show>
			</div>
			<Show when={connectingIface()}>
				{(iface: () => InterfaceJson): JSX.Element => (
					<ConnectPortDialog
						iface={iface()}
						on_connected={() => setConnectingIface(null)}
						on_close={() => setConnectingIface(null)}
					/>
				)}
			</Show>
			<Show when={editingIface()}>
				{(iface: () => InterfaceJson): JSX.Element => (
					<EditPortDialog
						device_id={props.id}
						iface={currentIface(iface()) ?? iface()}
						show_enabled={!isOtherPort(iface())}
						link={linksByIface().get(iface().id)}
						endToEnd={endToEndOf(iface().id)}
						on_saved={() => setEditingIface(null)}
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
						on_saved={() => setEditingRow(null)}
						on_close={() => setEditingRow(null)}
					/>
				)}
			</Show>
			<Show when={managingJacks()}>
				<JackDialog
					device_id={props.id}
					device_name={device()?.name ?? ''}
					ports={panelPorts()}
					jacks={jacks() ?? []}
					on_close={() => setManagingJacks(false)}
				/>
			</Show>
			<Show when={movingTenant() ? device() : undefined}>
				{(row: () => DeviceDetail): JSX.Element => (
					<MoveTenantDialog
						row={{ kind: 'device', ...row() }}
						on_moved={() => setMovingTenant(false)}
						on_close={() => setMovingTenant(false)}
					/>
				)}
			</Show>
			<InlineError message={error()} />
		</div>
	)
}
