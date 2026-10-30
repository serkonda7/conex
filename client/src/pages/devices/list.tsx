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
import { fetch_device_types } from '../../api/templates'
import { delete_virtual_machine } from '../../api/virtual_machines'
import type { DataTableColumn } from '../../components/data_table'
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
import { deviceRoleLabel } from '../../i18n/labels'
import { deviceRoleIcon } from '../../lib/icons'
import { useNameOf } from '../../lib/lookup'
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
 * search, sortable columns, kind / rack / role / tenant filters (tenant,
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
	const [filterSite] = useQueryFilter('site')
	const [filterEmployee, setFilterEmployee] = useQueryFilterList('employee')
	const [filterKind, setFilterKind] = useQueryFilterList('kind')
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
			site: parseId(filterSite()) ?? undefined,
			employee: idsOf(filterEmployee()),
			...tenantContextFilters(parseId(filterTenant()) ?? undefined),
		}),
		fetch: fetch_device_list,
		remove: delete_device,
		removeOf: (row: DeviceListItem) =>
			row.kind === 'vm' ? delete_virtual_machine : delete_device,
	})
	const [types] = createRows(fetch_device_types, list.setError)
	const [roles] = createRows(fetch_device_roles, list.setError)
	const [racks] = createRows(fetch_racks, list.setError)
	const [employees] = createRows(fetch_all_employees, list.setError)
	const employeeName = useNameOf(employees)
	const typeName = useNameOf(types, (type) => type.model)
	const roleName = useNameOf(roles, deviceRoleLabel)
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
	const rackName = useNameOf(racks)

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
					<IconLabel icon={deviceRoleIcon(roleById().get(d.device_role_id)?.icon)}>
						{roleName(d.device_role_id)}
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
					<a href={`/device-types/${d.device_type_id}`}>{typeName(d.device_type_id)}</a>
				),
		},
		{
			key: 'employee',
			label: t('device.assignedEmployee'),
			getValue: (device: DeviceListItem): JSX.Element =>
				device.employee_id === null ? (
					<span>—</span>
				) : (
					<a href={`/employees/${device.employee_id}`}>
						{employeeName(device.employee_id)}
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
								<a href={`/racks/${d.rack_id}`}>{rackName(d.rack_id)}</a>
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
					rack: d.rack_id === null ? tp('noun.rack', 1) : rackName(d.rack_id),
					u: d.position_u,
				})
				return d.rack_id === null ? (
					<span>{label}</span>
				) : (
					<a href={`/racks/${d.rack_id}`}>{label}</a>
				)
			},
		},
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
				]}
				filtered={
					filterTenant() !== '' ||
					filterType() !== '' ||
					filterSite() !== '' ||
					tenantContext().kind !== 'all'
				}
				columns={columns}
				columnsKey="devices"
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
						on_moved={() => {
							setMovingRow(null)
							list.reload()
						}}
						on_close={() => setMovingRow(null)}
					/>
				)}
			</Show>
		</>
	)
}
