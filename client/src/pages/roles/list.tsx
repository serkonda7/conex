import type { JSX } from 'solid-js'
import { delete_role, fetch_roles, type RoleJson } from '../../api/roles'
import { descriptionColumn } from '../../components/data_table'
import { EntityListPage, useEntityList } from '../../components/list_page'
import { t, tp } from '../../i18n'
import { permissionLabel } from '../../i18n/labels'

/**
 * /roles — role list (`users.manage`): search plus per-row edit/delete.
 * Permissions are picked on the add/edit pages; roles still assigned to
 * users cannot be deleted (the server answers 409).
 */
export function RolesPage(): JSX.Element {
	const list = useEntityList({
		noun: 'noun.role',
		manage: 'users.manage',
		fetch: fetch_roles,
		remove: delete_role,
	})

	return (
		<EntityListPage
			list={list}
			title={tp('entity.role', 2)}
			addHref="/roles/add"
			searchPlaceholder={t('common.quickSearch')}
			columns={[
				{
					key: 'name',
					label: t('common.name'),
					getValue: (r: RoleJson): string => r.name,
				},
				descriptionColumn(),
				{
					key: 'permissions',
					label: t('role.permissions'),
					getValue: (r: RoleJson): string =>
						r.permissions.length === 0
							? t('role.noPermissions')
							: r.permissions.map(permissionLabel).join(', '),
				},
				{
					key: 'users',
					label: tp('entity.user', 2),
					getValue: (r: RoleJson): string => String(r.user_count),
				},
			]}
			columnsKey="roles"
			rowName={(r: RoleJson): string => r.name}
			editHref={(r: RoleJson): string => `/roles/${r.id}/edit`}
			emptyText={t('role.empty')}
		/>
	)
}
