/**
 * /settings — the signed-in user's own account settings: read-only identity,
 * UI language and a self-service password change. Available to every signed-in
 * user, so the section needs no permission beyond the session.
 */
import { IconAdjustments, IconLock, IconShieldCheck, IconUserCog } from '@tabler/icons-solidjs'
import { createResource, createSignal, type JSX, Show } from 'solid-js'
import { fetchMe } from '../../api/auth'
import { LanguageSwitcher } from '../../app/language_switcher'
import { PasswordDialog } from '../../app/password_dialog'
import { InlineError, Loading } from '../../components/feedback'
import { IconLabel } from '../../components/icon_label'
import { t } from '../../i18n'

/** Account settings of the signed-in user. */
export function SettingsPage(): JSX.Element {
	const [user] = createResource(fetchMe)
	const [changingPassword, setChangingPassword] = createSignal(false)

	return (
		<div class="settings-page">
			<div class="page-header">
				<div class="page-header-title">
					<span class="page-header-icon" aria-hidden="true">
						<IconUserCog size={20} />
					</span>
					<h2>{t('account.settings')}</h2>
				</div>
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
							<dt>
								{t('account.password')}
								<span class="settings-hint">
									{t('account.passwordDescription')}
								</span>
							</dt>
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
							<dt>
								{t('app.language')}
								<span class="settings-hint">
									{t('account.languageDescription')}
								</span>
							</dt>
							<dd>
								<LanguageSwitcher />
							</dd>
						</dl>
					</section>
				</section>
			</Show>

			<Show when={changingPassword()}>
				<PasswordDialog on_close={() => setChangingPassword(false)} />
			</Show>
		</div>
	)
}
