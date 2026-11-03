import type { DeviceTypeEolFilter } from 'shared/src/schemas'
import { createMemo, type JSX } from 'solid-js'
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
import { deviceRoleLabel, deviceTypeEolOptions, yesNo, yesNoOptions } from '../../i18n/labels'
import { deviceRoleIcon } from '../../lib/icons'
import { useNameOf } from '../../lib/lookup'
import { createRows } from '../../lib/resource'
import { formatDate } from '../../lib/time'
import { deviceRoleOptions } from '../device-roles/options'
import { SpecLink } from './spec_link'

/**
 * /device-types — device-type list: search (model, part number, manufacturer,
 * description), sortable columns, manufacturer / default role / full depth /
 * EOL filters (manufacturer deep-linkable via `?manufacturer=<id>`
 * from the manufacturer page; manufacturer and role offer only values some
 * type has), and icon actions with delete in a row menu. "+ Add"
 * opens the /device-types/import page, the only way to create device types.
 */
export function DeviceTypesPage(): JSX.Element {
	const [filterManufacturer, setFilterManufacturer] = useQueryFilterList('manufacturer')
	const [filterRole, setFilterRole] = useQueryFilterList('role')
	const [filterFullDepth, setFilterFullDepth] = useQueryFilterList('full_depth')
	const [filterEol, setFilterEol] = useQueryFilterList('eol')
	const list = useEntityList({
		noun: 'noun.deviceType',
		sort: 'model' as DeviceTypeSort,
		filters: () => ({
			manufacturer: idsOf(filterManufacturer()),
			role: idsOf(filterRole()),
			// Both values chosen is the same as no filter.
			full_depth:
				filterFullDepth().length === 1 ? filterFullDepth()[0] === 'true' : undefined,
			eol: filterEol().length > 0 ? (filterEol() as DeviceTypeEolFilter[]) : undefined,
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
	// Only manufacturers with device types, plus a chosen one (deep link).
	const manufacturerOptions = createMemo(() =>
		idOptions(
			(manufacturers() ?? []).filter(
				(m) => m.device_type_count > 0 || filterManufacturer().includes(String(m.id)),
			),
		),
	)
	// Only roles some type defaults to, with their ancestors (a role filter
	// includes its child roles), plus chosen ones.
	const roleOptions = createMemo(() => {
		const all = roles() ?? []
		const byId = new Map(all.map((r) => [r.id, r]))
		const used = new Set<number>()
		for (const role of all) {
			if (role.device_type_count === 0 && !filterRole().includes(String(role.id))) {
				continue
			}
			let current: typeof role | undefined = role
			while (current && !used.has(current.id)) {
				used.add(current.id)
				current = current.parent_id === null ? undefined : byId.get(current.parent_id)
			}
		}
		return deviceRoleOptions(all)
			.filter((o) => used.has(o.value as number))
			.map((o) => ({ ...o, value: String(o.value) }))
	})

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
			sortable: true,
			label: t('deviceType.specUrl'),
			getValue: (dt: DeviceTypeListRow): JSX.Element =>
				dt.spec_url ? <SpecLink url={dt.spec_url} /> : <span>—</span>,
		},
		{
			key: 'eol_date',
			sortable: true,
			label: t('deviceType.eolDate'),
			getValue: (dt: DeviceTypeListRow): string =>
				dt.eol_date ? formatDate(dt.eol_date) : '—',
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
					options: manufacturerOptions(),
					value: filterManufacturer,
					onChange: setFilterManufacturer,
				},
				{
					key: 'role',
					label: t('deviceType.defaultRole'),
					options: roleOptions(),
					value: filterRole,
					onChange: setFilterRole,
				},
				{
					key: 'full_depth',
					label: t('common.fullDepth'),
					options: yesNoOptions(),
					value: filterFullDepth,
					onChange: setFilterFullDepth,
				},
				{
					key: 'eol',
					label: t('deviceType.eolDate'),
					options: deviceTypeEolOptions(),
					value: filterEol,
					onChange: setFilterEol,
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
