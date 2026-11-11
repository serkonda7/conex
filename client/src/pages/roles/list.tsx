import type { JSX } from 'solid-js'
import { delete_role, fetch_roles, type RoleJson, type RoleSort } from '../../api/roles'
import { CountLink, descriptionColumn } from '../../components/data_table'
import { EntityListPage, useEntityList } from '../../components/list_page'
import { t, tp } from '../../i18n'
import { permissionLabel } from '../../i18n/labels'

/**
 * /roles — role list (`users.manage`): search, sortable columns plus
 * per-row edit/delete.
 * Permissions are picked on the add/edit pages; roles still assigned to
 * users cannot be deleted (the server answers 409).
 */
export function RolesPage(): JSX.Element {
	const list = useEntityList({
		noun: 'noun.role',
		sort: 'name' as RoleSort,
		manage: 'users.manage',
		fetch: fetch_roles,
		remove: delete_role,
	})

	return (
		<EntityListPage
			list={list}
			title={tp('entity.role', 2)}
			addHref="/roles/add"
			columns={[
				{
					key: 'name',
					label: t('common.name'),
					sortable: true,
					getValue: (r: RoleJson): string => r.name,
				},
				descriptionColumn({ sortable: true }),
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
					sortable: true,
					getValue: (r: RoleJson): JSX.Element => (
						<CountLink count={r.user_count} href={`/users?role=${r.id}`} />
					),
				},
			]}
			columnsKey="roles"
			rowName={(r: RoleJson): string => r.name}
			editHref={(r: RoleJson): string => `/roles/${r.id}/edit`}
			emptyText={t('role.empty')}
		/>
	)
}
