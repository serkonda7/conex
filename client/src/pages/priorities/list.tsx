import type { JSX } from 'solid-js'
import {
	delete_priority,
	fetch_priorities,
	type PriorityListRow,
	type PrioritySort,
} from '../../api/service_catalog'
import { descriptionColumn, nameColumn } from '../../components/data_table'
import { EntityListPage, useEntityList } from '../../components/list_page'
import { t, tp } from '../../i18n'

/**
 * /priorities — ticket priority list, most urgent first: search, sortable
 * columns, and icon actions with delete in a row menu.
 */
export function PrioritiesPage(): JSX.Element {
	const list = useEntityList({
		noun: 'noun.priority',
		sort: 'rank' as PrioritySort,
		fetch: fetch_priorities,
		remove: delete_priority,
	})

	return (
		<EntityListPage
			list={list}
			title={tp('entity.priority', 2)}
			addHref="/priorities/add"
			columns={[
				{
					key: 'rank',
					label: t('priority.rank'),
					sortable: true,
					getValue: (r: PriorityListRow): string => String(r.rank),
				},
				nameColumn<PriorityListRow>(t('common.name'), '/priorities', { sortable: true }),
				descriptionColumn({ sortable: true }),
			]}
			columnsKey="priorities"
			rowName={(r: PriorityListRow): string => r.name}
			editHref={(r: PriorityListRow): string => `/priorities/${r.id}/edit`}
			emptyText={t('priority.empty')}
		/>
	)
}
