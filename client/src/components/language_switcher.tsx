import { createUniqueId, For, type JSX } from 'solid-js'
import { type Locale, locale, localeOptions, setLocale, t } from '../i18n'

/** Language `<select>` shown in the user menu and on the auth pages. */
export function LanguageSwitcher(): JSX.Element {
	const id = createUniqueId()
	return (
		<span class="app-language-switcher">
			<label class="visually-hidden" for={id}>
				{t('app.language')}
			</label>
			<select
				id={id}
				class="app-language-select"
				aria-label={t('app.language')}
				value={locale()}
				onChange={(e: Event & { currentTarget: HTMLSelectElement }): void => {
					setLocale(e.currentTarget.value as Locale)
				}}
			>
				<For each={localeOptions()}>
					{(opt: { value: Locale; label: string }): JSX.Element => (
						<option value={opt.value}>{opt.label}</option>
					)}
				</For>
			</select>
		</span>
	)
}
