/**
 * /settings — the signed-in user's own account settings: read-only identity,
 * UI language, the "open items in a new tab" preference, a self-service
 * password change and "view as role". Available to every signed-in user, so
 * the section needs no permission beyond the session.
 */
import { IconAdjustments, IconEye, IconLock, IconShieldCheck } from '@tabler/icons-solidjs'
import { Result } from 'better-result'
import { createResource, createSignal, createUniqueId, For, type JSX, Show } from 'solid-js'
import {
	fetchMe,
	fetchViewAsRoles,
	type SessionUser,
	setViewAs,
	type ViewAsRoleJson,
} from '../../api/auth'
import { LanguageSwitcher } from '../../app/language_switcher'
import { PasswordDialog } from '../../app/password_dialog'
import { InlineError, Loading } from '../../components/feedback'
import { IconLabel } from '../../components/icon_label'
import { t } from '../../i18n'
import { openItemsInNewTab, setOpenItemsInNewTab } from '../../lib/preferences'
import { updateSessionUser } from '../../lib/session'

/**
 * "View as role": try the app with the permissions of a role that grants
 * nothing beyond the user's own (the server decides which are offered).
 * Hidden when no role is offered and the session is not viewing as one.
 */
function ViewAsSection(props: {
	user: SessionUser
	onChange: (user: SessionUser) => void
}): JSX.Element {
	const id = createUniqueId()
	const [roles] = createResource(fetchViewAsRoles)
	const [busy, setBusy] = createSignal(false)
	const [error, setError] = createSignal<string | null>(null)
	const offered = (): ViewAsRoleJson[] => {
		const res = roles()
		return res && Result.isOk(res) ? res.value : []
	}
	const loadError = (): string | null => {
		const res = roles()
		return res && Result.isError(res) ? res.error.message : null
	}
	const shown = (): boolean =>
		props.user.view_as !== null || offered().length > 0 || loadError() !== null
	const hint = (): string | null => {
		const viewed = props.user.view_as
		const role = viewed && offered().find((r) => r.id === viewed.id)
		return role ? role.description : null
	}

	async function handleChange(value: string): Promise<void> {
		setBusy(true)
		setError(null)
		const res = await setViewAs(value === '' ? null : Number(value))
		setBusy(false)
		if (Result.isError(res)) {
			setError(res.error.message)
			return
		}
		props.onChange(res.value)
		updateSessionUser(res.value)
	}

	return (
		<Show when={shown()}>
			<section aria-label={t('viewAs.section')}>
				<h4>
					<IconEye class="settings-icon-view-as" size={16} aria-hidden="true" />
					<span>{t('viewAs.section')}</span>
				</h4>
				<dl>
					<dt>
						<label for={id}>{t('viewAs.role')}</label>
						<span class="settings-hint">{t('viewAs.description')}</span>
					</dt>
					<dd>
						<select
							id={id}
							disabled={busy() || roles.loading}
							onChange={(e: Event & { currentTarget: HTMLSelectElement }): void => {
								void handleChange(e.currentTarget.value)
							}}
						>
							{/* `selected` per option: the offered roles arrive after the select renders. */}
							<option value="" selected={props.user.view_as === null}>
								{t('viewAs.ownRole', { role: props.user.role.name })}
							</option>
							<For each={offered()}>
								{(role: ViewAsRoleJson): JSX.Element => (
									<option
										value={role.id}
										selected={props.user.view_as?.id === role.id}
									>
										{role.name}
									</option>
								)}
							</For>
						</select>
						<Show when={hint()}>
							{(text: () => string) => <span class="settings-hint">{text()}</span>}
						</Show>
						<InlineError message={error() ?? loadError()} alert />
					</dd>
				</dl>
			</section>
		</Show>
	)
}

/** Account settings of the signed-in user. */
export function SettingsPage(): JSX.Element {
	const [user, { mutate }] = createResource(fetchMe)
	const [changingPassword, setChangingPassword] = createSignal(false)

	return (
		<div class="settings-page">
			<div class="page-header">
				<h2>{t('account.settings')}</h2>
			</div>
			<p class="page-subtitle">{t('account.settingsSubtitle')}</p>

			<Show
				when={user()}
				fallback={
					<Show
						when={user.loading}
						fallback={<InlineError message={t('account.loadFailed')} alert />}
					>
						<Loading message={t('common.loading')} />
					</Show>
				}
			>
				<section class="spec-sheet stacked" aria-label={t('account.settings')}>
					<section aria-label={t('account.sectionAuthentication')}>
						<h4>
							<IconShieldCheck
								class="settings-icon-auth"
								size={16}
								aria-hidden="true"
							/>
							<span>{t('account.sectionAuthentication')}</span>
						</h4>
						<dl>
							<dt>{t('account.password')}</dt>
							<dd>
								<button type="button" onClick={() => setChangingPassword(true)}>
									<IconLabel icon={IconLock}>
										{t('account.changePassword')}
									</IconLabel>
								</button>
							</dd>
						</dl>
					</section>

					<section aria-label={t('account.sectionPreferences')}>
						<h4>
							<IconAdjustments
								class="settings-icon-prefs"
								size={16}
								aria-hidden="true"
							/>
							<span>{t('account.sectionPreferences')}</span>
						</h4>
						<dl>
							<dt>{t('app.language')}</dt>
							<dd>
								<LanguageSwitcher />
							</dd>
							<dt>
								{t('account.openItemsInNewTab')}
								<span class="settings-hint">
									{t('account.openItemsInNewTabDescription')}
								</span>
							</dt>
							<dd>
								<span class="settings-switch">
									<input
										type="checkbox"
										role="switch"
										class="toggle"
										aria-label={t('account.openItemsInNewTab')}
										aria-checked={openItemsInNewTab()}
										checked={openItemsInNewTab()}
										onChange={(
											e: Event & { currentTarget: HTMLInputElement },
										) => setOpenItemsInNewTab(e.currentTarget.checked)}
									/>
								</span>
							</dd>
						</dl>
					</section>

					<Show when={user()}>
						{(current: () => SessionUser) => (
							<ViewAsSection
								user={current()}
								onChange={(next: SessionUser) => mutate(next)}
							/>
						)}
					</Show>
				</section>
			</Show>

			<Show when={changingPassword()}>
				<PasswordDialog on_close={() => setChangingPassword(false)} />
			</Show>
		</div>
	)
}
