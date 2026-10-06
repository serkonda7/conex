import type { JSX } from 'solid-js'
import {
	type DeviceRoleListRow,
	type DeviceRoleSort,
	delete_device_role,
	fetch_device_roles,
} from '../../api/device_roles'
import { descriptionColumn } from '../../components/data_table'
import { IconLabel } from '../../components/icon_label'
import { EntityListPage, useEntityList } from '../../components/list_page'
import { t, tp } from '../../i18n'
import { deviceRoleIcon } from '../../lib/icons'

/**
 * /device-roles — device role list: search, sortable columns, row
 * selection with bulk delete, and icon actions with delete in a row menu.
 */
export function DeviceRolesPage(): JSX.Element {
	const list = useEntityList({
		noun: 'noun.deviceRole',
		sort: 'name' as DeviceRoleSort,
		fetch: fetch_device_roles,
		remove: delete_device_role,
	})

	return (
		<EntityListPage
			list={list}
			title={tp('entity.deviceRole', 2)}
			addHref="/device-roles/add"
			searchPlaceholder={t('deviceRole.searchPlaceholder')}
			columns={[
				{
					key: 'name',
					label: t('common.name'),
					sortable: true,
					getValue: (r: DeviceRoleListRow): JSX.Element => (
						<IconLabel icon={deviceRoleIcon(r.icon)}>
							<a href={`/device-roles/${r.id}`}>{r.name}</a>
						</IconLabel>
					),
				},
				descriptionColumn({ sortable: true }),
				{
					key: 'devices',
					label: tp('entity.device', 2),
					getValue: (r: DeviceRoleListRow): string => String(r.device_count),
				},
			]}
			columnsKey="device-roles"
			rowName={(r: DeviceRoleListRow): string => r.name}
			editHref={(r: DeviceRoleListRow): string => `/device-roles/${r.id}/edit`}
			deletable={(r: DeviceRoleListRow): boolean => r.key === null}
			emptyText={t('deviceRole.empty')}
		/>
	)
}
