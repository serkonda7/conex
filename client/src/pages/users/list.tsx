import type { JSX } from 'solid-js'
import { fetch_tenants } from '../../api/tenancy'
import { delete_user, fetch_users, type UserJson } from '../../api/users'
import { EntityListPage, useEntityList } from '../../components/list_page'
import { t, tp } from '../../i18n'
import { useNameOf } from '../../lib/lookup'
import { createRows } from '../../lib/resource'

/**
 * /users — account list (`users.manage`): search plus per-row edit/delete.
 * Role/tenant assignment lives on the dedicated add/edit pages. Password
 * hashes never leave the server, so this table shows identity and scope
 * only.
 */
export function UsersPage(): JSX.Element {
	const list = useEntityList({
		noun: 'noun.user',
		manage: 'users.manage',
		fetch: fetch_users,
		remove: delete_user,
	})
	// Tenant id → name for the scope column (user managers are global).
	const [tenants] = createRows(fetch_tenants)
	const tenantName = useNameOf(tenants)
	const scopeOf = (id: number | null): string =>
		id === null ? t('common.allTenants') : tenantName(id)

	return (
		<EntityListPage
			list={list}
			title={tp('entity.user', 2)}
			addHref="/users/add"
			searchPlaceholder={t('common.quickSearch')}
			columns={[
				{
					key: 'username',
					label: t('auth.username'),
					getValue: (u: UserJson): string => u.username,
				},
				{
					key: 'role',
					label: t('user.role'),
					getValue: (u: UserJson): string => u.role_name,
				},
				{
					key: 'tenant',
					label: t('user.tenantScope'),
					getValue: (u: UserJson): string => scopeOf(u.tenant_id),
				},
			]}
			columnsKey="users"
			rowName={(u: UserJson): string => u.username}
			editHref={(u: UserJson): string => `/users/${u.id}/edit`}
			emptyText={t('user.empty')}
		/>
	)
}
