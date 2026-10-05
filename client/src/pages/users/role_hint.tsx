import { type JSX, Show } from 'solid-js'
import type { RoleJson } from '../../api/roles'
import { Hint } from '../../components/form'
import { t } from '../../i18n'
import { permissionLabel } from '../../i18n/labels'

/** Permissions of the selected role, shown under the role select. */
export function RoleHint(props: { role: RoleJson | undefined }): JSX.Element {
	return (
		<Show when={props.role}>
			{(role: () => RoleJson) => (
				<Hint>
					{role().permissions.length === 0
						? t('role.noPermissions')
						: t('user.roleGrants', {
								permissions: role().permissions.map(permissionLabel).join(', '),
							})}
				</Hint>
			)}
		</Show>
	)
}

/** True when the role grants `users.manage`: such users are always global. */
export function managesUsers(role: RoleJson | undefined): boolean {
	return role?.permissions.includes('users.manage') ?? false
}
