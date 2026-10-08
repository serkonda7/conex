import type { JSX } from 'solid-js'
import {
	type DeviceTypeListRow,
	type DeviceTypeSort,
	delete_device_type,
	fetch_device_types,
	fetch_manufacturers,
} from '../../api/templates'
import type { DataTableColumn } from '../../components/data_table'
import { EntityListPage, useEntityList, useQueryFilter } from '../../components/list_page'
import { Markdown } from '../../components/markdown'
import { t, tp } from '../../i18n'
import { yesNo } from '../../i18n/labels'
import { useNameOf } from '../../lib/lookup'
import { createRows } from '../../lib/resource'
import { navigate, parseId } from '../../lib/router'

/**
 * /device-types — device-type list: search (model, manufacturer, description),
 * sortable columns, manufacturer filter via `?manufacturer=<id>` (linked from
 * the manufacturer page), and icon actions
 * with delete in a row menu. New types can be added manually or imported from
 * the /device-types/import page.
 */
export function DeviceTypesPage(): JSX.Element {
	const [filterManufacturer] = useQueryFilter('manufacturer')
	const list = useEntityList({
		noun: 'noun.deviceType',
		sort: 'model' as DeviceTypeSort,
		filters: () => ({ manufacturer: parseId(filterManufacturer()) ?? undefined }),
		fetch: fetch_device_types,
		remove: delete_device_type,
	})
	const [manufacturers] = createRows(fetch_manufacturers, list.setError)
	const manufacturerName = useNameOf(manufacturers)

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
			addHref="/device-types/add"
			headerActions={
				<button
					type="button"
					class="btn-add"
					onClick={() => navigate('/device-types/import')}
				>
					{t('deviceType.import')}
				</button>
			}
			searchPlaceholder={t('common.quickSearch')}
			filtered={filterManufacturer() !== ''}
			columns={columns}
			columnsKey="device-types"
			defaultColumns={['manufacturer', 'model', 'description', 'devices']}
			rowName={(dt: DeviceTypeListRow): string => dt.model}
			editHref={(dt: DeviceTypeListRow): string => `/device-types/${dt.id}/edit`}
			emptyText={t('deviceType.empty')}
		/>
	)
}
