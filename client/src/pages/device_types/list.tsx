import type { JSX } from 'solid-js'
import { fetch_device_roles } from '../../api/device_roles'
import {
	type DeviceTypeListRow,
	type DeviceTypeSort,
	delete_device_type,
	fetch_device_types,
	fetch_manufacturers,
} from '../../api/templates'
import type { DataTableColumn } from '../../components/data_table'
import { IconLabel } from '../../components/icon_label'
import {
	EntityListPage,
	idOptions,
	idsOf,
	useEntityList,
	useQueryFilterList,
} from '../../components/list_page'
import { Markdown } from '../../components/markdown'
import { t, tp } from '../../i18n'
import { deviceRoleLabel, yesNo } from '../../i18n/labels'
import { deviceRoleIcon } from '../../lib/icons'
import { useNameOf } from '../../lib/lookup'
import { createRows } from '../../lib/resource'
import { deviceRoleOptions } from '../device-roles/options'
import { SpecLink } from './spec_link'

/**
 * /device-types — device-type list: search (model, part number, manufacturer,
 * description), sortable columns, manufacturer / default role / full depth
 * filters (manufacturer deep-linkable via `?manufacturer=<id>` from the
 * manufacturer page), and icon actions with delete in a row menu. "+ Add"
 * opens the /device-types/import page, the only way to create device types.
 */
export function DeviceTypesPage(): JSX.Element {
	const [filterManufacturer, setFilterManufacturer] = useQueryFilterList('manufacturer')
	const [filterRole, setFilterRole] = useQueryFilterList('role')
	const [filterFullDepth, setFilterFullDepth] = useQueryFilterList('full_depth')
	const list = useEntityList({
		noun: 'noun.deviceType',
		sort: 'model' as DeviceTypeSort,
		filters: () => ({
			manufacturer: idsOf(filterManufacturer()),
			role: idsOf(filterRole()),
			// Both values chosen is the same as no filter.
			full_depth:
				filterFullDepth().length === 1 ? filterFullDepth()[0] === 'true' : undefined,
		}),
		fetch: fetch_device_types,
		remove: delete_device_type,
	})
	const [manufacturers] = createRows(fetch_manufacturers, list.setError)
	const [roles] = createRows(fetch_device_roles, list.setError)
	const manufacturerName = useNameOf(manufacturers)
	const roleName = useNameOf(roles, deviceRoleLabel)
	const roleIcon = (id: number): ReturnType<typeof deviceRoleIcon> =>
		deviceRoleIcon(roles()?.find((r) => r.id === id)?.icon)

	const columns: DataTableColumn<DeviceTypeListRow>[] = [
		{
			key: 'manufacturer',
			label: tp('entity.manufacturer', 1),
			sortable: true,
			getValue: (dt: DeviceTypeListRow): JSX.Element => (
				<a href={`/manufacturers/${dt.manufacturer_id}`}>
					{manufacturerName(dt.manufacturer_id)}
				</a>
			),
		},
		{
			key: 'model',
			label: t('common.model'),
			sortable: true,
			getValue: (dt: DeviceTypeListRow): JSX.Element => (
				<a href={`/device-types/${dt.id}`}>{dt.model}</a>
			),
		},
		{
			key: 'part_number',
			sortable: true,
			label: t('deviceType.partNumber'),
			getValue: (dt: DeviceTypeListRow): string => dt.part_number || '—',
		},
		{
			key: 'role',
			sortable: true,
			label: t('deviceType.defaultRole'),
			getValue: (dt: DeviceTypeListRow): JSX.Element => {
				const id = dt.default_device_role_id
				return id === null ? (
					<span>—</span>
				) : (
					<a href={`/device-roles/${id}`}>
						<IconLabel icon={roleIcon(id)}>{roleName(id)}</IconLabel>
					</a>
				)
			},
		},
		{
			key: 'description',
			sortable: true,
			label: t('common.description'),
			getValue: (dt: DeviceTypeListRow): string => dt.description ?? '—',
		},
		{
			key: 'comments',
			sortable: true,
			label: t('common.comments'),
			class: 'cell-truncate',
			getValue: (dt: DeviceTypeListRow): JSX.Element => (
				<Markdown text={dt.comments} inline />
			),
		},
		{
			key: 'u_height',
			sortable: true,
			label: t('common.heightU'),
			getValue: (dt: DeviceTypeListRow): string => `${dt.u_height}`,
		},
		{
			key: 'is_full_depth',
			sortable: true,
			label: t('common.fullDepth'),
			getValue: (dt: DeviceTypeListRow): string => yesNo(dt.is_full_depth),
		},
		{
			key: 'spec_url',
			label: t('deviceType.specUrl'),
			getValue: (dt: DeviceTypeListRow): JSX.Element =>
				dt.spec_url ? <SpecLink url={dt.spec_url} /> : <span>—</span>,
		},
		{
			key: 'devices',
			sortable: true,
			label: tp('entity.device', 2),
			getValue: (dt: DeviceTypeListRow): JSX.Element => (
				<a href={`/devices?device_type=${dt.id}`}>{dt.instance_count}</a>
			),
		},
	]

	return (
		<EntityListPage
			list={list}
			title={tp('entity.deviceType', 2)}
			addHref="/device-types/import"
			filters={[
				{
					key: 'manufacturer',
					label: tp('entity.manufacturer', 1),
					options: idOptions(manufacturers()),
					value: filterManufacturer,
					onChange: setFilterManufacturer,
				},
				{
					key: 'role',
					label: t('deviceType.defaultRole'),
					options: deviceRoleOptions(roles() ?? []).map((o) => ({
						...o,
						value: String(o.value),
					})),
					value: filterRole,
					onChange: setFilterRole,
				},
				{
					key: 'full_depth',
					label: t('common.fullDepth'),
					options: [
						{ value: 'true', label: t('common.yes') },
						{ value: 'false', label: t('common.no') },
					],
					value: filterFullDepth,
					onChange: setFilterFullDepth,
				},
			]}
			columns={columns}
			columnsKey="device-types"
			defaultColumns={['manufacturer', 'model', 'description', 'devices']}
			rowName={(dt: DeviceTypeListRow): string => dt.model}
			editHref={(dt: DeviceTypeListRow): string => `/device-types/${dt.id}/edit`}
			emptyText={t('deviceType.empty')}
		/>
	)
}
