import { IconArrowsExchange } from '@tabler/icons-solidjs'
import { createMemo, createSignal, type JSX, Show } from 'solid-js'
import { fetch_device_roles } from '../../api/device_roles'
import { type DeviceRow, type DeviceSort, delete_device, fetch_devices } from '../../api/devices'
import { fetch_all_employees } from '../../api/employees'
import { fetch_racks } from '../../api/racks'
import { fetch_device_types } from '../../api/templates'
import { type DataTableColumn, nameColumn } from '../../components/data_table'
import { IconLabel } from '../../components/icon_label'
import {
	EntityListPage,
	idOptions,
	useEntityList,
	useQueryFilter,
} from '../../components/list_page'
import { t, tp } from '../../i18n'
import { deviceRoleIcon } from '../../lib/icons'
import { useNameOf } from '../../lib/lookup'
import { createRows } from '../../lib/resource'
import { parseId } from '../../lib/router'
import { canGlobal } from '../../lib/session'
import { tenantContext, tenantContextFilters } from '../../lib/tenant_context'
import { MoveTenantDialog } from './move_tenant_dialog'

/**
 * /devices — NetBox-style device list: search, sortable columns, rack /
 * role / tenant filters (tenant, role and device type deep-linkable via
 * `?tenant=<id>`, `?role=<id>` and `?device_type=<id>`), and icon actions with
 * clone, move to another tenant and delete in a row menu.
 */
export function DevicesPage(): JSX.Element {
	const [filterRack, setFilterRack] = createSignal('')
	const [filterRole, setFilterRole] = useQueryFilter('role')
	const [filterTenant] = useQueryFilter('tenant')
	const [filterType] = useQueryFilter('device_type')
	const [filterEmployee, setFilterEmployee] = useQueryFilter('employee')
	const [movingDevice, setMovingDevice] = createSignal<DeviceRow | null>(null)
	const list = useEntityList({
		noun: 'noun.device',
		sort: 'name' as DeviceSort,
		filters: () => ({
			rack: parseId(filterRack()) ?? undefined,
			role: parseId(filterRole()) ?? undefined,
			device_type: parseId(filterType()) ?? undefined,
			employee: parseId(filterEmployee()) ?? undefined,
			...tenantContextFilters(parseId(filterTenant()) ?? undefined),
		}),
		fetch: fetch_devices,
		remove: delete_device,
	})
	const [types] = createRows(fetch_device_types, list.setError)
	const [roles] = createRows(fetch_device_roles, list.setError)
	const [racks] = createRows(fetch_racks, list.setError)
	const [employees] = createRows(fetch_all_employees, list.setError)
	const employeeName = useNameOf(employees)
	const typeName = useNameOf(types, (type) => type.model)
	const roleName = useNameOf(roles)
	const roleById = createMemo(() => new Map((roles() ?? []).map((r) => [r.id, r])))
	const rackName = useNameOf(racks)

	const columns: DataTableColumn<DeviceRow>[] = [
		nameColumn(tp('entity.device', 1), '/devices', { sortable: true }),
		{
			key: 'device_id',
			label: t('device.deviceId'),
			sortable: true,
			getValue: (d: DeviceRow): string => d.device_id ?? '—',
		},
		{
			key: 'role',
			label: tp('entity.deviceRole', 1),
			sortable: true,
			getValue: (d: DeviceRow): JSX.Element => (
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
			getValue: (d: DeviceRow): JSX.Element => (
				<a href={`/device-types/${d.device_type_id}`}>{typeName(d.device_type_id)}</a>
			),
		},
		{
			key: 'employee',
			label: t('device.assignedEmployee'),
			getValue: (device: DeviceRow): JSX.Element =>
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
			getValue: (d: DeviceRow): JSX.Element => {
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
						options: idOptions(roles()),
						value: filterRole,
						onChange: setFilterRole,
					},
				]}
				filtered={
					filterTenant() !== '' || filterType() !== '' || tenantContext().kind !== 'all'
				}
				columns={columns}
				columnsKey="devices"
				rowName={(d: DeviceRow): string => d.name}
				editHref={(d: DeviceRow): string => `/devices/${d.id}/edit`}
				cloneHref={(d: DeviceRow): string => `/devices/add?clone=${d.id}`}
				menuActions={(d: DeviceRow) =>
					canGlobal('edit')
						? [
								{
									label: t('device.moveTenant'),
									icon: IconArrowsExchange,
									onSelect: (): void => {
										setMovingDevice(d)
									},
								},
							]
						: []
				}
				emptyText={t('device.empty')}
			/>
			<Show when={movingDevice()}>
				{(device: () => DeviceRow): JSX.Element => (
					<MoveTenantDialog
						device={device()}
						on_moved={() => {
							setMovingDevice(null)
							list.reload()
						}}
						on_close={() => setMovingDevice(null)}
					/>
				)}
			</Show>
		</>
	)
}
