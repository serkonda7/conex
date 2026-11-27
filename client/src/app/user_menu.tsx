/** Account link at the right end of the top bar. */
import { IconLogout, IconUserCircle } from '@tabler/icons-solidjs'
import { type JSX, Show } from 'solid-js'
import type { SessionUser } from '../api/auth'
import { t } from '../i18n'

/** Account link to the signed-in user's settings page. */
export function UserMenu(props: { user: SessionUser | null }): JSX.Element {
	const name = (): string => props.user?.username ?? '…'

	return (
		<div class="app-user-menu">
			<a
				href="/settings"
				class="app-user-button"
				aria-label={t('app.accountNamed', { name: name() })}
			>
				<span aria-hidden="true" class="app-nav-icon app-user-icon">
					<IconUserCircle size={20} />
				</span>
				<span class="app-user-info">
					<span class="app-user-username">{name()}</span>
					<Show when={props.user}>
						{(user: () => SessionUser) => (
							<span class="app-user-role" classList={{ 'view-as': !!user().view_as }}>
								{user().view_as?.name ?? user().role.name}
							</span>
						)}
					</Show>
				</span>
			</a>
		</div>
	)
}

/** Always-visible icon button to the right of the account menu. */
export function LogoutButton(props: { onLogout: () => void }): JSX.Element {
	return (
		<button
			type="button"
			class="app-logout-button"
			aria-label={t('app.logout')}
			title={t('app.logout')}
			onClick={() => props.onLogout()}
		>
			<span aria-hidden="true" class="app-nav-icon">
				<IconLogout size={20} />
			</span>
		</button>
	)
}
