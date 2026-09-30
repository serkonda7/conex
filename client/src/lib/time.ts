import { locale } from '../i18n'

/** Unix seconds as a short local date/time in the UI language. */
export function formatTime(seconds: number): string {
	return new Intl.DateTimeFormat(locale(), { dateStyle: 'medium', timeStyle: 'short' }).format(
		new Date(seconds * 1000),
	)
}
