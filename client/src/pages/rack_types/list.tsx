import type { JSX } from 'solid-js'
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
import { formFactorLabel } from '../../i18n/labels'
import { useNameOf } from '../../lib/lookup'
import { createRows } from '../../lib/resource'

/**
 * /rack-types — rack-type catalog: search, sortable columns, manufacturer
 * filter (deep-linkable via `?manufacturer=<id>`), and delete in a row menu.
 */
export function RackTypesPage(): JSX.Element {
	const [filterManufacturer, setFilterManufacturer] = useQueryFilterList('manufacturer')
	const list = useEntityList({
		noun: 'noun.rackType',
		sort: 'model' as RackTypeSort,
		filters: () => ({
			manufacturer: idsOf(filterManufacturer()),
		}),
		fetch: fetch_rack_types,
		remove: delete_rack_type,
	})
	const [manufacturers] = createRows(fetch_manufacturers, list.setError)
	const manufacturerName = useNameOf(manufacturers)

	const columns: DataTableColumn<RackTypeListRow>[] = [
		{
			key: 'model',
			label: t('common.model'),
			sortable: true,
			getValue: (rt: RackTypeListRow): JSX.Element => (
				<a href={`/rack-types/${rt.id}`}>{rt.model}</a>
			),
		},
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
		{
			key: 'form_factor',
			label: t('rackType.formFactor'),
			sortable: true,
			getValue: (rt: RackTypeListRow): string => formFactorLabel(rt.form_factor),
		},
		{
			key: 'width',
			label: t('rackType.width'),
			getValue: (rt: RackTypeListRow): string => `${rt.width}″`,
		},
		{
			key: 'u_height',
			label: t('common.heightU'),
			getValue: (rt: RackTypeListRow): string => `${rt.u_height}`,
		},
		{
			key: 'description',
			label: t('common.description'),
			getValue: (rt: RackTypeListRow): string => rt.description ?? '—',
		},
		{
			key: 'comments',
			label: t('common.comments'),
			class: 'cell-truncate',
			getValue: (rt: RackTypeListRow): JSX.Element => <Markdown text={rt.comments} inline />,
		},
		{
			key: 'racks',
			label: tp('entity.rack', 2),
			getValue: (rt: RackTypeListRow): JSX.Element => (
				<a href={`/racks?rack_type=${rt.id}`}>{rt.instance_count}</a>
			),
		},
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
