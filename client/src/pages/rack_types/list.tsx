import { createMemo, type JSX } from 'solid-js'
import type { RackFormFactor } from '../../api/templates'
import {
	delete_rack_type,
	fetch_manufacturers,
	fetch_rack_types,
	type RackTypeListRow,
	type RackTypeSort,
} from '../../api/templates'
import type { DataTableColumn } from '../../components/data_table'
import {
	EntityListPage,
	idOptions,
	idsOf,
	useEntityList,
	useQueryFilterList,
} from '../../components/list_page'
import { Markdown } from '../../components/markdown'
import { t, tp } from '../../i18n'
import { formFactorOptions } from '../../i18n/labels'
import { useNameOf } from '../../lib/lookup'
import { createRows } from '../../lib/resource'
import {
	rackTypeFormFactorColumn,
	rackTypeHeightColumn,
	rackTypeModelColumn,
	rackTypeRacksColumn,
} from './columns'

/**
 * /rack-types — rack-type catalog: search, sortable columns, manufacturer
 * (deep-linkable via `?manufacturer=<id>`), form factor and height filters
 * (height offers only values some type has), and delete in a row menu.
 */
export function RackTypesPage(): JSX.Element {
	const [filterManufacturer, setFilterManufacturer] = useQueryFilterList('manufacturer')
	const [filterFormFactor, setFilterFormFactor] = useQueryFilterList('form_factor')
	const [filterHeight, setFilterHeight] = useQueryFilterList('height')
	const list = useEntityList({
		noun: 'noun.rackType',
		sort: 'model' as RackTypeSort,
		filters: () => ({
			manufacturer: idsOf(filterManufacturer()),
			form_factor:
				filterFormFactor().length > 0
					? (filterFormFactor() as RackFormFactor[])
					: undefined,
			height: idsOf(filterHeight()),
		}),
		fetch: fetch_rack_types,
		remove: delete_rack_type,
	})
	const [manufacturers] = createRows(fetch_manufacturers, list.setError)
	const manufacturerName = useNameOf(manufacturers)
	const [allTypes] = createRows(fetch_rack_types, list.setError)
	// Heights some type has, plus chosen ones (deep link), ascending.
	const heightOptions = createMemo(() =>
		[
			...new Set([
				...(allTypes() ?? []).map((rt) => rt.u_height),
				...(idsOf(filterHeight()) ?? []),
			]),
		]
			.sort((a, b) => a - b)
			.map((u) => ({ value: String(u), label: `${u}` })),
	)

	const columns: DataTableColumn<RackTypeListRow>[] = [
		rackTypeModelColumn({ sortable: true }),
		{
			key: 'manufacturer',
			label: tp('entity.manufacturer', 1),
			sortable: true,
			getValue: (rt: RackTypeListRow): JSX.Element => (
				<a href={`/manufacturers/${rt.manufacturer_id}`}>
					{manufacturerName(rt.manufacturer_id)}
				</a>
			),
		},
		rackTypeFormFactorColumn({ sortable: true }),
		{
			key: 'width',
			label: t('rackType.width'),
			getValue: (rt: RackTypeListRow): string => `${rt.width}″`,
		},
		rackTypeHeightColumn({ sortable: true }),
		{
			key: 'description',
			sortable: true,
			label: t('common.description'),
			getValue: (rt: RackTypeListRow): string => rt.description ?? '—',
		},
		{
			key: 'comments',
			sortable: true,
			label: t('common.comments'),
			class: 'cell-truncate',
			getValue: (rt: RackTypeListRow): JSX.Element => <Markdown text={rt.comments} inline />,
		},
		rackTypeRacksColumn({ sortable: true }),
	]

	return (
		<EntityListPage
			list={list}
			title={tp('entity.rackType', 2)}
			addHref="/rack-types/add"
			filters={[
				{
					key: 'manufacturer',
					label: tp('entity.manufacturer', 1),
					options: idOptions(manufacturers()),
					value: filterManufacturer,
					onChange: setFilterManufacturer,
				},
				{
					key: 'form_factor',
					label: t('rackType.formFactor'),
					options: formFactorOptions().map((o) => ({ value: o.value, label: o.label })),
					value: filterFormFactor,
					onChange: setFilterFormFactor,
				},
				{
					key: 'height',
					label: t('common.heightU'),
					options: heightOptions(),
					value: filterHeight,
					onChange: setFilterHeight,
				},
			]}
			columns={columns}
			columnsKey="rack-types"
			defaultColumns={[
				'model',
				'manufacturer',
				'form_factor',
				'u_height',
				'description',
				'comments',
				'racks',
			]}
			rowName={(rt: RackTypeListRow): string => rt.model}
			editHref={(rt: RackTypeListRow): string => `/rack-types/${rt.id}/edit`}
			emptyText={t('rackType.empty')}
		/>
	)
}
