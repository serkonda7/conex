import { type JSX, Show } from 'solid-js'
import { fetch_roles } from '../../api/roles'
import { fetch_tenants } from '../../api/tenancy'
import { delete_user, fetch_users, type UserJson, type UserSort } from '../../api/users'
import {
	EntityListPage,
	idOptions,
	idsOf,
	useEntityList,
	useQueryFilterList,
} from '../../components/list_page'
import { t, tp } from '../../i18n'
import { useNameOf } from '../../lib/lookup'
import { createRows } from '../../lib/resource'

/**
 * /users — account list (`users.manage`): search (username or employee),
 * sortable columns, role filter (deep-linkable via `?role=<id>`) plus
 * per-row edit/delete. Role/employee/tenant assignment lives on the
 * dedicated add/edit pages. Password hashes never leave the server, so this
 * table shows identity and scope only.
 */
export function UsersPage(): JSX.Element {
	const [filterRole, setFilterRole] = useQueryFilterList('role')
	const list = useEntityList({
		noun: 'noun.user',
		sort: 'username' as UserSort,
		manage: 'users.manage',
		filters: () => ({ role: idsOf(filterRole()) }),
		fetch: fetch_users,
		remove: delete_user,
	})
	const [roles] = createRows(fetch_roles, list.setError)
	// Tenant id → name for the scope column (user managers are global).
	const [tenants] = createRows(fetch_tenants)
	const tenantName = useNameOf(tenants)
	const scopeOf = (ids: readonly number[]): string =>
		ids.length === 0 ? t('common.allTenants') : ids.map(tenantName).join(', ')

	return (
		<EntityListPage
			list={list}
			title={tp('entity.user', 2)}
			addHref="/users/add"
			filters={[
				{
					key: 'role',
					label: t('entity.role.one'),
					options: idOptions(roles()),
					value: filterRole,
					onChange: setFilterRole,
				},
			]}
			columns={[
				{
					key: 'username',
					label: t('auth.username'),
					sortable: true,
					getValue: (u: UserJson): string => u.username,
				},
				{
					key: 'employee',
					label: t('user.employee'),
					sortable: true,
					getValue: (u: UserJson): JSX.Element => (
						<Show when={u.employee_id !== null} fallback="—">
							<a href={`/employees/${u.employee_id}`}>{u.employee_name}</a>
							<Show when={!u.active}> ({t('user.inactive')})</Show>
						</Show>
					),
				},
				{
					key: 'role',
					label: t('entity.role.one'),
					sortable: true,
					getValue: (u: UserJson): JSX.Element => (
						<a href={`/roles/${u.role_id}/edit`}>{u.role_name}</a>
					),
				},
				{
					key: 'tenant',
					label: t('user.tenantScope'),
					getValue: (u: UserJson): string => scopeOf(u.tenant_ids),
				},
			]}
			columnsKey="users"
			rowName={(u: UserJson): string => u.username}
			editHref={(u: UserJson): string => `/users/${u.id}/edit`}
			emptyText={t('user.empty')}
		/>
	)
}
