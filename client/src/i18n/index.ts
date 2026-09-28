/**
 * Minimal typed localization. `en` is the source of truth for message keys;
 * every other locale must provide the exact same key set (enforced by the
 * `Messages` type). Placeholders use `{name}` syntax, plurals use sibling
 * `<key>.one` / `<key>.other` entries resolved through `Intl.PluralRules`.
 *
 * The active locale is a reactive signal persisted to localStorage
 * (`conex:locale`), defaulting to German. `t`/`tp` read the signal, so JSX
 * expressions using them update on switch; labels computed once in page
 * bodies (table columns, …) refresh through the locale-keyed remount in
 * `App.tsx`.
 */
import { createSignal } from 'solid-js'
import { de } from './de'
import { en, type Messages } from './en'

export type Locale = 'en' | 'de'

export type MessageKey = keyof Messages

/** Base keys that have both a `.one` and an `.other` variant. */
export type PluralKey = {
	[K in MessageKey]: K extends `${infer B}.other`
		? `${B}.one` extends MessageKey
			? B
			: never
		: never
}[MessageKey]

export type MessageParams = Record<string, string | number>

export const LOCALES: readonly Locale[] = ['en', 'de']

const STORAGE_KEY = 'conex:locale'

/** Default UI language; German keeps first visits matching previous builds. */
const DEFAULT_LOCALE: Locale = 'de'

function isLocale(value: unknown): value is Locale {
	return value === 'en' || value === 'de'
}

/** Stored preference, or the default when unset or unreadable. */
function initialLocale(): Locale {
	try {
		if (typeof window !== 'undefined') {
			const stored = window.localStorage.getItem(STORAGE_KEY)
			if (isLocale(stored)) {
				return stored
			}
		}
	} catch {
		// Storage unavailable (private mode, …): fall through to the default.
	}
	return DEFAULT_LOCALE
}

const [locale, setLocaleState] = createSignal<Locale>(initialLocale())

if (typeof document !== 'undefined') {
	document.documentElement.lang = locale()
}

/** Reactive active UI language. */
export { locale }

/** Switches the UI language, persists the choice and updates `<html lang>`. */
export function setLocale(next: Locale): void {
	if (!isLocale(next)) {
		return
	}
	setLocaleState(next)
	try {
		if (typeof window !== 'undefined') {
			window.localStorage.setItem(STORAGE_KEY, next)
		}
	} catch {
		// The choice still applies to the session when it cannot persist.
	}
	if (typeof document !== 'undefined') {
		document.documentElement.lang = next
	}
}

/** Language `<select>` options with native names (stable across locales). */
export function localeOptions(): { value: Locale; label: string }[] {
	return LOCALES.map((value) => ({
		value,
		label: t(`app.languageName.${value}` as MessageKey),
	}))
}

const dictionaries: Record<Locale, Messages> = { en, de }

const pluralRulesCache = new Map<Locale, Intl.PluralRules>()

function pluralRulesFor(loc: Locale): Intl.PluralRules {
	let rules = pluralRulesCache.get(loc)
	if (!rules) {
		rules = new Intl.PluralRules(loc)
		pluralRulesCache.set(loc, rules)
	}
	return rules
}

function interpolate(template: string, params: MessageParams | undefined): string {
	if (params === undefined) {
		return template
	}
	return template.replace(/\{(\w+)\}/g, (match: string, name: string): string => {
		const value = params[name]
		return value === undefined ? match : String(value)
	})
}

/** Translates `key` into the active locale, substituting `{param}` placeholders. */
export function t(key: MessageKey, params?: MessageParams): string {
	return interpolate(dictionaries[locale()][key], params)
}

/** Translates a plural message; `{count}` is available as a placeholder. */
export function tp(key: PluralKey, count: number, params?: MessageParams): string {
	const form = pluralRulesFor(locale()).select(count) === 'one' ? 'one' : 'other'
	return t(`${key}.${form}` as MessageKey, { count, ...params })
}
