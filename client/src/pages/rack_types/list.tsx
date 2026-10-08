import type { JSX } from 'solid-js'
import {
	type DeviceTypeListRow,
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
import { formFactorLabel } from '../../i18n/labels'
import { useNameOf } from '../../lib/lookup'
import { createRows } from '../../lib/resource'
import { parseId } from '../../lib/router'

/**
 * /rack-types — rack-type catalog: search, sortable columns, manufacturer
 * filter (deep-linkable via `?manufacturer=<id>`), and delete in a row menu.
 * There is no edit page.
 */
export function RackTypesPage(): JSX.Element {
	const [filterManufacturer, setFilterManufacturer] = useQueryFilter('manufacturer')
	const list = useEntityList({
		noun: 'noun.rackType',
		sort: 'model' as DeviceTypeSort,
		filters: () => ({
			manufacturer: parseId(filterManufacturer()) ?? undefined,
			kind: 'rack' as const,
		}),
		fetch: fetch_device_types,
		remove: delete_device_type,
	})
	const [manufacturers] = createRows(fetch_manufacturers, list.setError)
	const manufacturerName = useNameOf(manufacturers)

	const columns: DataTableColumn<DeviceTypeListRow>[] = [
		{
			key: 'model',
			label: t('common.model'),
			sortable: true,
			getValue: (dt: DeviceTypeListRow): string => dt.model,
		},
		{
			key: 'manufacturer',
			label: tp('entity.manufacturer', 1),
			sortable: true,
			getValue: (dt: DeviceTypeListRow): string => manufacturerName(dt.manufacturer_id),
		},
		{
			key: 'form_factor',
			label: t('rackType.formFactor'),
			sortable: true,
			getValue: (dt: DeviceTypeListRow): string =>
				dt.form_factor ? formFactorLabel(dt.form_factor) : '—',
		},
		{
			key: 'width',
			label: t('rackType.width'),
			getValue: (dt: DeviceTypeListRow): string => (dt.width === null ? '—' : `${dt.width}″`),
		},
		{
			key: 'u_height',
			label: t('common.heightU'),
			getValue: (dt: DeviceTypeListRow): string => `${dt.u_height}`,
		},
		{
			key: 'racks',
			label: tp('entity.rack', 2),
			getValue: (dt: DeviceTypeListRow): string => String(dt.instance_count),
		},
	]

	return (
		<EntityListPage
			list={list}
			title={tp('entity.rackType', 2)}
			addHref="/rack-types/add"
			searchPlaceholder={t('common.quickSearch')}
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
			columnsKey="rack-types"
			rowName={(dt: DeviceTypeListRow): string => dt.model}
			emptyText={t('rackType.empty')}
		/>
	)
}
