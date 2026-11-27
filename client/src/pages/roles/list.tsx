import { PERMISSIONS } from 'shared/src/schemas'
import type { Permission } from 'shared/src/types'
import { For, type JSX, Show } from 'solid-js'
import { delete_role, fetch_roles, type RoleJson, type RoleSort } from '../../api/roles'
import { CountLink, descriptionColumn } from '../../components/data_table'
import { EntityListPage, useEntityList } from '../../components/list_page'
import { t, tp } from '../../i18n'
import { objectAccessLabel, permissionLabel, permissionShortLabel } from '../../i18n/labels'
import { userTabs } from '../users/list'
import {
	INTEGRATION_PERMISSIONS,
	integrationAccess,
	OBJECT_PERMISSIONS,
	objectAccess,
} from './object_access'

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
			tabs={userTabs('roles')}
			columns={[
				{
					key: 'name',
					label: t('common.name'),
					sortable: true,
					getValue: (r: RoleJson): JSX.Element => (
						<a href={`/roles/${r.id}/edit`}>{r.name}</a>
					),
				},
				descriptionColumn({ sortable: true }),
				{
					key: 'permissions',
					label: t('role.permissions'),
					getValue: (r: RoleJson): JSX.Element => (
						<PermissionBadges list={r.permissions} />
					),
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

/**
 * Permissions as short badges (full label as tooltip): view/edit/delete
 * collapse to one object access badge and the integration permissions to
 * one integration access badge, matching the role form, and a role
 * granting every permission to a single "All permissions" badge.
 */
function PermissionBadges(props: { list: Permission[] }): JSX.Element {
	if (props.list.length === 0) {
		return <span class="text-muted">{t('role.noPermissions')}</span>
	}
	if (props.list.length === PERMISSIONS.length) {
		return <span class="badge badge-active">{t('role.allPermissions')}</span>
	}
	const level = (): string => objectAccess(props.list)
	const integrations = (): string => integrationAccess(props.list)
	const others = (): Permission[] =>
		props.list.filter(
			(p) => !OBJECT_PERMISSIONS.includes(p) && !INTEGRATION_PERMISSIONS.includes(p),
		)
	return (
		<span class="badge-list">
			<Show when={level() !== ''}>
				<span class="badge">
					{t('role.objectAccessBadge', { level: objectAccessLabel(level()) })}
				</span>
			</Show>
			<Show when={integrations() !== ''}>
				<span class="badge">
					{t('role.integrationAccessBadge', { level: objectAccessLabel(integrations()) })}
				</span>
			</Show>
			<For each={others()}>
				{(p: Permission): JSX.Element => (
					<span class="badge" title={permissionLabel(p)}>
						{permissionShortLabel(p)}
					</span>
				)}
			</For>
		</span>
	)
}
