import type { JSX } from 'solid-js'
import { Hint } from '../../components/form'
import { t } from '../../i18n'

/** What each role may do, shown under the role select. */
export function RoleHint(props: { children?: JSX.Element }): JSX.Element {
	return (
		<Hint>
			{t('user.roleHint', {
				admin: t('role.admin'),
				editor: t('role.editor'),
				viewer: t('role.viewer'),
			})}
			{props.children}
		</Hint>
	)
}
