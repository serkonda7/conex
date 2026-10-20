import type { JSX } from 'solid-js'
import {
	delete_service_level,
	fetch_service_levels,
	type ServiceLevelListRow,
	type ServiceLevelSort,
} from '../../api/service_catalog'
import { descriptionColumn, nameColumn } from '../../components/data_table'
import { EntityListPage, useEntityList } from '../../components/list_page'
import { t, tp } from '../../i18n'
import { holidayRegionLabel } from '../../i18n/labels'
import { formatServiceHours } from '../../lib/service_level'
import { managedServiceTabs } from '../managed-bundles/list'

/**
 * /service-levels — service level (SLA) list: search, sortable columns,
 * service hours at a glance, and icon actions with delete in a row menu.
 */
export function ServiceLevelsPage(): JSX.Element {
	const list = useEntityList({
		noun: 'noun.serviceLevel',
		sort: 'name' as ServiceLevelSort,
		fetch: fetch_service_levels,
		remove: delete_service_level,
	})

	return (
		<EntityListPage
			list={list}
			title={tp('entity.serviceLevel', 2)}
			tabs={managedServiceTabs('service-levels')}
			addHref="/service-levels/add"
			columns={[
				nameColumn<ServiceLevelListRow>(t('common.name'), '/service-levels', {
					sortable: true,
				}),
				descriptionColumn({ sortable: true }),
				{
					key: 'service_hours',
					label: t('serviceLevel.serviceHours'),
					getValue: (r: ServiceLevelListRow): string =>
						formatServiceHours(r.service_hours) || '—',
				},
				{
					key: 'holiday_region',
					label: t('serviceLevel.holidayRegion'),
					getValue: (r: ServiceLevelListRow): string =>
						r.holiday_region === null
							? t('serviceLevel.holidayNationwide')
							: holidayRegionLabel(r.holiday_region),
				},
				{
					key: 'targets',
					label: t('serviceLevel.targets'),
					getValue: (r: ServiceLevelListRow): string => String(r.target_count),
				},
			]}
			columnsKey="service-levels"
			rowName={(r: ServiceLevelListRow): string => r.name}
			editHref={(r: ServiceLevelListRow): string => `/service-levels/${r.id}/edit`}
			emptyText={t('serviceLevel.empty')}
		/>
	)
}
