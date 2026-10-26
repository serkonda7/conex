import type { JSX } from 'solid-js'
import {
	delete_priority,
	fetch_priorities,
	type PriorityListRow,
	type PrioritySort,
} from '../../api/service_catalog'
import { descriptionColumn } from '../../components/data_table'
import { EntityListPage, useEntityList } from '../../components/list_page'
import { PriorityPill } from '../../components/priority_pill'
import { t, tp } from '../../i18n'
import { managedServiceTabs } from '../managed-bundles/list'

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
			tabs={managedServiceTabs('priorities')}
			addHref="/priorities/add"
			columns={[
				{
					key: 'rank',
					label: t('priority.rank'),
					sortable: true,
					getValue: (r: PriorityListRow): string => String(r.rank),
				},
				{
					key: 'name',
					label: t('common.name'),
					sortable: true,
					getValue: (r: PriorityListRow): JSX.Element => (
						<a href={`/priorities/${r.id}`}>
							<PriorityPill name={r.name} color={r.color} />
						</a>
					),
				},
				descriptionColumn({ sortable: true }),
			]}
			columnsKey="priorities"
			rowName={(r: PriorityListRow): string => r.name}
			editHref={(r: PriorityListRow): string => `/priorities/${r.id}/edit`}
			emptyText={t('priority.empty')}
		/>
	)
}
