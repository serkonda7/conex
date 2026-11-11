import { IconArrowsExchange, IconCloudPlus } from '@tabler/icons-solidjs'
import type { DeviceListKind } from 'shared/src/types'
import { createMemo, createSignal, type JSX, Show } from 'solid-js'
import { fetch_device_roles } from '../../api/device_roles'
import {
	type DeviceListItem,
	type DeviceSort,
	delete_device,
	fetch_device_list,
} from '../../api/devices'
import { fetch_all_employees } from '../../api/employees'
import { fetch_racks } from '../../api/racks'
import { delete_virtual_machine } from '../../api/virtual_machines'
import { type DataTableColumn, descriptionColumn } from '../../components/data_table'
import { IconLabel } from '../../components/icon_label'
import {
	EntityListPage,
	idOptions,
	idsOf,
	type RowMenuAction,
	useEntityList,
	useQueryFilter,
	useQueryFilterList,
} from '../../components/list_page'
import { treeIcons, treePaths } from '../../components/tree_name'
import { t, tp } from '../../i18n'
import { deviceRoleLabel, deviceStatusLabel } from '../../i18n/labels'
import { deviceRoleIcon } from '../../lib/icons'
import { createRows } from '../../lib/resource'
import { navigate, parseId } from '../../lib/router'
import { can, canGlobal } from '../../lib/session'
import { tenantContext, tenantContextFilters } from '../../lib/tenant_context'
import { MoveTenantDialog } from './move_tenant_dialog'
import { DeviceStatusBadge } from './status'

/** Detail route of a list row: `/devices/:id` or `/devices/vm/:id`. */
export function deviceListHref(row: DeviceListItem): string {
	return row.kind === 'vm' ? `/devices/vm/${row.id}` : `/devices/${row.id}`
}

/**
 * /devices — NetBox-style device list of devices and virtual machines:
 * search, sortable columns, kind / active / rack / role / EOL / tenant filters (tenant,
 * role and device type deep-linkable via `?tenant=<id>`, `?role=<id>` and
 * `?device_type=<id>`), and icon actions with clone, move to another tenant
 * and delete in a row menu. Ids collide across the two kinds, so rows are
 * keyed `device-<id>` / `vm-<id>`.
 */
export function DevicesPage(): JSX.Element {
	const [filterRack, setFilterRack] = createSignal<string[]>([])
	const [filterRole, setFilterRole] = useQueryFilterList('role')
	const [filterTenant] = useQueryFilter('tenant')
	const [filterType] = useQueryFilter('device_type')
	const [filterManufacturer] = useQueryFilter('manufacturer')
	const [filterSite] = useQueryFilter('site')
	const [filterEmployee, setFilterEmployee] = useQueryFilterList('employee')
	const [filterKind, setFilterKind] = useQueryFilterList('kind')
	const [filterPastEol, setFilterPastEol] = useQueryFilterList('past_eol')
	const [filterActive, setFilterActive] = useQueryFilterList('active')
	const [movingRow, setMovingRow] = createSignal<DeviceListItem | null>(null)
	const list = useEntityList({
		noun: 'noun.device',
		sort: 'name' as DeviceSort,
		filters: () => ({
			// Both kinds chosen is the same as no filter.
			kind: (filterKind().length === 1 ? filterKind()[0] : undefined) as
				| DeviceListKind
				| undefined,
			rack: idsOf(filterRack()),
			role: idsOf(filterRole()),
			device_type: parseId(filterType()) ?? undefined,
			manufacturer: parseId(filterManufacturer()) ?? undefined,
			site: parseId(filterSite()) ?? undefined,
			employee: idsOf(filterEmployee()),
			// Both values chosen is the same as no filter.
			past_eol: filterPastEol().length === 1 ? filterPastEol()[0] === 'true' : undefined,
			active: filterActive().length === 1 ? filterActive()[0] === 'true' : undefined,
			...tenantContextFilters(parseId(filterTenant()) ?? undefined),
		}),
		fetch: fetch_device_list,
		remove: delete_device,
		removeOf: (row: DeviceListItem) =>
			row.kind === 'vm' ? delete_virtual_machine : delete_device,
	})
	// Rows carry their related names; these lookups feed the filters (and
	// the role's `can_host_vms` for the row menu).
	const [roles] = createRows(fetch_device_roles, list.setError)
	const [racks] = createRows(fetch_racks, list.setError)
	const [employees] = createRows(fetch_all_employees, list.setError)
	const roleById = createMemo(() => new Map((roles() ?? []).map((r) => [r.id, r])))
	const roleFilterOptions = createMemo(() => {
		const all = roles() ?? []
		const paths = treePaths(all, deviceRoleLabel)
		const icons = treeIcons(all)
		return all.map((r) => ({
			value: String(r.id),
			label: paths.get(r.id) ?? deviceRoleLabel(r),
			icon: deviceRoleIcon(icons.get(r.id)),
		}))
	})
	// A name outside the requester's tenant scope comes back null: show the id.
	const nameOr = (name: string | null, id: number | null): string =>
		name ?? (id === null ? '—' : String(id))

	const columns: DataTableColumn<DeviceListItem>[] = [
		{
			key: 'name',
			label: tp('entity.device', 1),
			sortable: true,
			getValue: (d: DeviceListItem): JSX.Element => <a href={deviceListHref(d)}>{d.name}</a>,
		},
		{
			key: 'status',
			label: t('common.status'),
			sortable: true,
			getValue: (d: DeviceListItem): JSX.Element => <DeviceStatusBadge status={d.status} />,
		},
		{
			key: 'device_id',
			label: t('device.deviceId'),
			sortable: true,
			getValue: (d: DeviceListItem): string => (d.kind === 'device' && d.device_id) || '—',
		},
		{
			key: 'role',
			label: tp('entity.deviceRole', 1),
			sortable: true,
			getValue: (d: DeviceListItem): JSX.Element => (
				<a href={`/device-roles/${d.device_role_id}`}>
					<IconLabel icon={deviceRoleIcon(d.device_role_icon)}>
						{deviceRoleLabel({ name: d.device_role_name, key: d.device_role_key })}
					</IconLabel>
				</a>
			),
		},
		{
			key: 'type',
			label: t('common.type'),
			sortable: true,
			getValue: (d: DeviceListItem): JSX.Element =>
				d.kind === 'vm' ? (
					<span>{t('entity.virtualMachine.one')}</span>
				) : (
					<a href={`/device-types/${d.device_type_id}`}>{d.device_type_model}</a>
				),
		},
		{
			key: 'employee',
			label: t('device.assignedEmployee'),
			sortable: true,
			getValue: (device: DeviceListItem): JSX.Element =>
				device.employee_id === null ? (
					<span>—</span>
				) : (
					<a href={`/employees/${device.employee_id}`}>
						{nameOr(device.employee_name, device.employee_id)}
					</a>
				),
		},
		{
			key: 'mount',
			label: t('device.mount'),
			sortable: true,
			getValue: (d: DeviceListItem): JSX.Element => {
				if (d.kind === 'vm') {
					return d.host_device_id === null ? (
						<span>{t('deviceRoleIcon.cloud')}</span>
					) : (
						<a href={`/devices/${d.host_device_id}`}>{d.host_name}</a>
					)
				}
				if (d.shelf_id !== null) {
					const shelfLabel = t('device.onShelf', {
						name:
							d.shelf_name ||
							t('common.unitPosition', { u: d.shelf_position_u ?? '' }),
					})
					return (
						<span>
							<Show when={d.rack_id !== null}>
								<a href={`/racks/${d.rack_id}`}>{nameOr(d.rack_name, d.rack_id)}</a>
								{' · '}
							</Show>
							<Show when={d.rack_id !== null} fallback={shelfLabel}>
								<a href={`/racks/${d.rack_id}`}>{shelfLabel}</a>
							</Show>
						</span>
					)
				}
				if (d.position_u === null) {
					return <span>—</span>
				}
				const label = t('device.mountPosition', {
					rack: d.rack_id === null ? tp('noun.rack', 1) : nameOr(d.rack_name, d.rack_id),
					u: d.position_u,
				})
				return d.rack_id === null ? (
					<span>{label}</span>
				) : (
					<a href={`/racks/${d.rack_id}`}>{label}</a>
				)
			},
		},
		{
			key: 'tenant',
			label: tp('entity.tenant', 1),
			sortable: true,
			getValue: (d: DeviceListItem): string => nameOr(d.tenant_name, d.tenant_id),
		},
		{
			key: 'site',
			label: tp('entity.site', 1),
			sortable: true,
			getValue: (d: DeviceListItem): JSX.Element =>
				d.kind === 'device' && d.site_id !== null ? (
					<a href={`/sites/${d.site_id}`}>{nameOr(d.site_name, d.site_id)}</a>
				) : (
					<span>—</span>
				),
		},
		{
			key: 'serial',
			label: t('device.serial'),
			sortable: true,
			getValue: (d: DeviceListItem): string => (d.kind === 'device' && d.serial) || '—',
		},
		{
			key: 'asset_tag',
			label: t('device.assetTag'),
			sortable: true,
			getValue: (d: DeviceListItem): string => (d.kind === 'device' && d.asset_tag) || '—',
		},
		descriptionColumn({ sortable: true }),
	]

	return (
		<>
			<EntityListPage
				list={list}
				title={tp('entity.device', 2)}
				addHref="/devices/add"
				filters={[
					{
						key: 'kind',
						label: t('vm.kind'),
						options: [
							{ value: 'device', label: t('entity.device.other') },
							{ value: 'vm', label: t('entity.virtualMachine.other') },
						],
						value: filterKind,
						onChange: setFilterKind,
					},
					{
						key: 'active',
						label: t('common.status'),
						options: [
							{ value: 'true', label: deviceStatusLabel('active') },
							{ value: 'false', label: deviceStatusLabel('inactive') },
						],
						value: filterActive,
						onChange: setFilterActive,
					},
					{
						key: 'employee',
						label: t('device.assignedEmployee'),
						options: idOptions(employees()),
						value: filterEmployee,
						onChange: setFilterEmployee,
					},
					{
						key: 'rack',
						label: tp('entity.rack', 1),
						options: idOptions(racks()),
						value: filterRack,
						onChange: setFilterRack,
					},
					{
						key: 'role',
						label: tp('entity.deviceRole', 1),
						options: roleFilterOptions(),
						value: filterRole,
						onChange: setFilterRole,
					},
					{
						key: 'past_eol',
						label: t('manufacturer.pastEol'),
						options: [
							{ value: 'true', label: t('common.yes') },
							{ value: 'false', label: t('common.no') },
						],
						value: filterPastEol,
						onChange: setFilterPastEol,
					},
				]}
				filtered={
					filterTenant() !== '' ||
					filterType() !== '' ||
					filterManufacturer() !== '' ||
					filterSite() !== '' ||
					tenantContext().kind !== 'all'
				}
				columns={columns}
				columnsKey="devices"
				defaultColumns={[
					'name',
					'status',
					'device_id',
					'role',
					'type',
					'employee',
					'mount',
				]}
				rowName={(d: DeviceListItem): string => d.name}
				rowKey={(d: DeviceListItem): string => `${d.kind}-${d.id}`}
				editHref={(d: DeviceListItem): string => `${deviceListHref(d)}/edit`}
				cloneHref={(d: DeviceListItem): string =>
					d.kind === 'vm' ? `/devices/vm/add?clone=${d.id}` : `/devices/add?clone=${d.id}`
				}
				menuActions={(d: DeviceListItem): RowMenuAction[] => {
					const actions: RowMenuAction[] = []
					if (
						can('edit') &&
						d.kind === 'device' &&
						roleById().get(d.device_role_id)?.can_host_vms === 1
					) {
						actions.push({
							label: t('vm.addVm'),
							icon: IconCloudPlus,
							onSelect: (): void => navigate(`/devices/vm/add?host=${d.id}`),
						})
					}
					// A hosted VM follows its host's tenant.
					if (canGlobal('edit') && !(d.kind === 'vm' && d.host_device_id !== null)) {
						actions.push({
							label: t('device.moveTenant'),
							icon: IconArrowsExchange,
							onSelect: (): void => {
								setMovingRow(d)
							},
						})
					}
					return actions
				}}
				emptyText={t('device.empty')}
			/>
			<Show when={movingRow()}>
				{(row: () => DeviceListItem): JSX.Element => (
					<MoveTenantDialog
						row={row()}
						on_moved={() => setMovingRow(null)}
						on_close={() => setMovingRow(null)}
					/>
				)}
			</Show>
		</>
	)
}
