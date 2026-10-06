import { createMemo, createSignal, type JSX } from 'solid-js'
import { fetch_device_roles } from '../../api/device_roles'
import { type DeviceRow, type DeviceSort, delete_device, fetch_devices } from '../../api/devices'
import { fetch_racks } from '../../api/racks'
import { fetch_device_types } from '../../api/templates'
import { type DataTableColumn, nameColumn } from '../../components/data_table'
import { IconLabel } from '../../components/icon_label'
import {
	EntityListPage,
	FilterSelect,
	useEntityList,
	useQueryFilter,
} from '../../components/list_page'
import { t, tp } from '../../i18n'
import { deviceRoleIcon } from '../../lib/icons'
import { useNameOf } from '../../lib/lookup'
import { createRows } from '../../lib/resource'
import { parseId } from '../../lib/router'
import { tenantContext, tenantContextFilters } from '../../lib/tenant_context'

/**
 * /devices — NetBox-style device list: search, sortable columns, rack /
 * role / tenant filters (tenant and role deep-linkable via `?tenant=<id>`
 * and `?role=<id>`), row selection with bulk delete, and icon actions with
 * delete in a row menu.
 */
export function DevicesPage(): JSX.Element {
	const [filterRack, setFilterRack] = createSignal('')
	const [filterRole, setFilterRole] = useQueryFilter('role')
	const [filterTenant] = useQueryFilter('tenant')
	const list = useEntityList({
		noun: 'noun.device',
		sort: 'name' as DeviceSort,
		filters: () => ({
			rack: parseId(filterRack()) ?? undefined,
			role: parseId(filterRole()) ?? undefined,
			...tenantContextFilters(parseId(filterTenant()) ?? undefined),
		}),
		fetch: fetch_devices,
		remove: delete_device,
	})
	const [types] = createRows(fetch_device_types, list.setError)
	const [roles] = createRows(fetch_device_roles, list.setError)
	const [racks] = createRows(fetch_racks, list.setError)
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
				<IconLabel icon={deviceRoleIcon(roleById().get(d.device_role_id)?.icon)}>
					{roleName(d.device_role_id)}
				</IconLabel>
			),
		},
		{
			key: 'type',
			label: t('common.type'),
			sortable: true,
			getValue: (d: DeviceRow): string => typeName(d.device_type_id),
		},
		{
			key: 'mount',
			label: t('device.mount'),
			sortable: true,
			getValue: (d: DeviceRow): JSX.Element => (
				<span>
					{d.position_u !== null ? (
						<code>
							{t('device.mountPosition', {
								rack: d.rack_id === null ? tp('noun.rack', 1) : rackName(d.rack_id),
								u: d.position_u,
							})}
						</code>
					) : (
						<span>—</span>
					)}
				</span>
			),
		},
	]

	return (
		<EntityListPage
			list={list}
			title={tp('entity.device', 2)}
			addHref="/devices/add"
			searchPlaceholder={t('device.searchPlaceholder')}
			filters={
				<>
					<FilterSelect
						label={t('device.filterByRack')}
						allLabel={t('device.allRacks')}
						value={filterRack()}
						onChange={setFilterRack}
						rows={racks() ?? []}
					/>
					<FilterSelect
						label={t('device.filterByRole')}
						allLabel={t('device.allRoles')}
						value={filterRole()}
						onChange={setFilterRole}
						rows={roles() ?? []}
					/>
				</>
			}
			filtered={
				filterRack() !== '' ||
				filterRole() !== '' ||
				filterTenant() !== '' ||
				tenantContext().kind !== 'all'
			}
			columns={columns}
			columnsKey="devices"
			rowName={(d: DeviceRow): string => d.name}
			editHref={(d: DeviceRow): string => `/devices/${d.id}/edit`}
			emptyText={t('device.empty')}
		/>
	)
}
