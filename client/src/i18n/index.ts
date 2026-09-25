/**
 * Minimal typed localization. `en` is the source of truth for message keys;
 * every other locale must provide the exact same key set (enforced by the
 * `Messages` type). Placeholders use `{name}` syntax, plurals use sibling
 * `<key>.one` / `<key>.other` entries resolved through `Intl.PluralRules`.
 */
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

/** UI language; hardcoded until a language switcher exists. */
export const LOCALE: Locale = 'de'

const dictionaries: Record<Locale, Messages> = { en, de }

const messages: Messages = dictionaries[LOCALE]

const pluralRules = new Intl.PluralRules(LOCALE)

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
	return interpolate(messages[key], params)
}

/** Translates a plural message; `{count}` is available as a placeholder. */
export function tp(key: PluralKey, count: number, params?: MessageParams): string {
	const form = pluralRules.select(count) === 'one' ? 'one' : 'other'
	return t(`${key}.${form}` as MessageKey, { count, ...params })
}
