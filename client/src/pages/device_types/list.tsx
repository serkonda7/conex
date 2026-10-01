import type { JSX } from 'solid-js'
import {
	type DeviceTypeRow,
	type DeviceTypeSort,
	delete_device_type,
	fetch_device_types,
	fetch_manufacturers,
} from '../../api/templates'
import type { DataTableColumn } from '../../components/data_table'
import {
	EntityListPage,
	FilterSelect,
	useEntityList,
	useQueryFilter,
} from '../../components/list_page'
import { t, tp } from '../../i18n'
import { useNameOf } from '../../lib/lookup'
import { createRows } from '../../lib/resource'
import { navigate, parseId } from '../../lib/router'

/**
 * /device-types — device-type list: search, sortable columns, manufacturer
 * filter (deep-linkable via `?manufacturer=<id>`), row selection with bulk
 * delete, and icon actions with delete in a row menu. New types can be added
 * manually or imported from the /device-types/import page.
 */
export function DeviceTypesPage(): JSX.Element {
	const [filterManufacturer, setFilterManufacturer] = useQueryFilter('manufacturer')
	const list = useEntityList({
		noun: 'noun.deviceType',
		sort: 'model' as DeviceTypeSort,
		filters: () => ({ manufacturer: parseId(filterManufacturer()) ?? undefined }),
		fetch: fetch_device_types,
		remove: delete_device_type,
	})
	const [manufacturers] = createRows(fetch_manufacturers, list.setError)
	const manufacturerName = useNameOf(manufacturers)

	const columns: DataTableColumn<DeviceTypeRow>[] = [
		{
			key: 'manufacturer',
			label: tp('entity.manufacturer', 1),
			sortable: true,
			getValue: (dt: DeviceTypeRow): string => manufacturerName(dt.manufacturer_id),
		},
		{
			key: 'model',
			label: t('common.model'),
			sortable: true,
			getValue: (dt: DeviceTypeRow): JSX.Element => (
				<a href={`/device-types/${dt.id}`}>{dt.model}</a>
			),
		},
		{
			key: 'description',
			label: t('common.description'),
			getValue: (dt: DeviceTypeRow): string => dt.description ?? '—',
		},
		{
			key: 'comments',
			label: t('common.comments'),
			getValue: (dt: DeviceTypeRow): string => dt.comments ?? '—',
		},
		{
			key: 'u_height',
			label: t('common.heightU'),
			getValue: (dt: DeviceTypeRow): string => `${dt.u_height}`,
		},
		{
			key: 'is_full_depth',
			label: t('common.fullDepth'),
			getValue: (dt: DeviceTypeRow): string =>
				dt.is_full_depth ? t('common.yes') : t('common.no'),
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
			searchPlaceholder={t('deviceType.searchPlaceholder')}
			filters={
				<FilterSelect
					label={t('deviceType.filterByManufacturer')}
					allLabel={t('deviceType.allManufacturers')}
					value={filterManufacturer()}
					onChange={setFilterManufacturer}
					rows={manufacturers() ?? []}
				/>
			}
			filtered={filterManufacturer() !== ''}
			columns={columns}
			columnsKey="device-types"
			defaultColumns={['manufacturer', 'model', 'description']}
			rowName={(dt: DeviceTypeRow): string => dt.model}
			editHref={(dt: DeviceTypeRow): string => `/device-types/${dt.id}/edit`}
			emptyText={t('deviceType.empty')}
		/>
	)
}
