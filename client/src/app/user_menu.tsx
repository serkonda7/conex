/** Account controls at the right end of the top bar. */
import { IconKey, IconLogout, IconUserCircle } from '@tabler/icons-solidjs'
import { createSignal, type JSX, Show } from 'solid-js'
import type { SessionUser } from '../api/auth'
import { t } from '../i18n'
import { useDismiss } from '../lib/dismiss'
import { LanguageSwitcher } from './language_switcher'
import { PasswordDialog } from './password_dialog'

/** Account button with the language switcher and password change in its dropdown. */
export function UserMenu(props: { user: SessionUser | null }): JSX.Element {
	const [open, setOpen] = createSignal(false)
	const [changingPassword, setChangingPassword] = createSignal(false)
	const name = (): string => props.user?.username ?? '…'

	useDismiss('.app-user-menu', () => setOpen(false))

	return (
		<div class="app-user-menu">
			<button
				type="button"
				class="app-user-button"
				aria-haspopup="menu"
				aria-expanded={open()}
				aria-label={t('app.accountNamed', { name: name() })}
				onClick={() => setOpen(!open())}
				onKeyDown={(e: KeyboardEvent): void => {
					if (e.key === 'Escape') {
						setOpen(false)
					}
				}}
			>
				<span aria-hidden="true" class="app-nav-icon app-user-icon">
					<IconUserCircle size={20} />
				</span>
				<span class="app-user-info">
					<span class="app-user-username">{name()}</span>
					<Show when={props.user}>
						{(user: () => SessionUser) => (
							<span class="app-user-role">{user().role.name}</span>
						)}
					</Show>
				</span>
			</button>
			<Show when={open()}>
				<div class="app-user-dropdown" role="menu">
					<div class="app-user-language">
						<LanguageSwitcher />
					</div>
					<button
						type="button"
						role="menuitem"
						class="app-user-menu-item"
						onClick={() => {
							setOpen(false)
							setChangingPassword(true)
						}}
					>
						<span aria-hidden="true" class="app-nav-icon">
							<IconKey size={16} />
						</span>
						{t('account.changePassword')}
					</button>
				</div>
			</Show>
			<Show when={changingPassword()}>
				<PasswordDialog on_close={() => setChangingPassword(false)} />
			</Show>
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
