import type { JSX } from 'solid-js'
import {
	delete_manufacturer,
	fetch_manufacturers,
	type ManufacturerRow,
	type ManufacturerSort,
} from '../../api/templates'
import { descriptionColumn, nameColumn } from '../../components/data_table'
import { EntityListPage, useEntityList } from '../../components/list_page'
import { t, tp } from '../../i18n'

/**
 * /manufacturers — manufacturer list: search, sortable columns, row
 * selection with bulk delete, and icon actions with delete in a row menu.
 */
export function ManufacturersPage(): JSX.Element {
	const list = useEntityList({
		noun: 'noun.manufacturer',
		sort: 'name' as ManufacturerSort,
		fetch: fetch_manufacturers,
		remove: delete_manufacturer,
	})

	return (
		<EntityListPage
			list={list}
			title={tp('entity.manufacturer', 2)}
			addHref="/manufacturers/add"
			searchPlaceholder={t('manufacturer.searchPlaceholder')}
			columns={[
				nameColumn<ManufacturerRow>(t('common.name'), '/manufacturers', { sortable: true }),
				descriptionColumn({ sortable: true }),
			]}
			columnsKey="manufacturers"
			rowName={(m: ManufacturerRow): string => m.name}
			editHref={(m: ManufacturerRow): string => `/manufacturers/${m.id}/edit`}
			emptyText={t('manufacturer.empty')}
		/>
	)
}
