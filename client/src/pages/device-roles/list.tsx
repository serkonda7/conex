import type { JSX } from 'solid-js'
import {
	type DeviceRoleRow,
	type DeviceRoleSort,
	delete_device_role,
	fetch_device_roles,
} from '../../api/device_roles'
import { descriptionColumn, nameColumn } from '../../components/data_table'
import { EntityListPage, useEntityList } from '../../components/list_page'
import { t, tp } from '../../i18n'

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
				nameColumn<DeviceRoleRow>(t('common.name'), '/device-roles', { sortable: true }),
				descriptionColumn({ sortable: true }),
			]}
			columnsKey="device-roles"
			rowName={(r: DeviceRoleRow): string => r.name}
			editHref={(r: DeviceRoleRow): string => `/device-roles/${r.id}/edit`}
			deletable={(r: DeviceRoleRow): boolean => r.key === null}
			emptyText={t('deviceRole.empty')}
		/>
	)
}
