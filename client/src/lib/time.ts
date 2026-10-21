import { locale } from '../i18n'

/** Unix seconds as a short local date/time in the UI language. */
export function formatTime(seconds: number): string {
	return new Intl.DateTimeFormat(locale(), { dateStyle: 'medium', timeStyle: 'short' }).format(
		new Date(seconds * 1000),
	)
}

const RELATIVE_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
	['day', 86_400],
	['hour', 3600],
	['minute', 60],
]

/** Unix seconds as a narrow relative time (`12 min. ago`), dates after a week. */
export function formatRelative(seconds: number): string {
	const elapsed = Math.max(0, Date.now() / 1000 - seconds)
	if (elapsed >= 7 * 86_400) {
		return new Intl.DateTimeFormat(locale(), { dateStyle: 'medium' }).format(
			new Date(seconds * 1000),
		)
	}
	const format = new Intl.RelativeTimeFormat(locale(), { style: 'narrow', numeric: 'auto' })
	for (const [unit, size] of RELATIVE_UNITS) {
		if (elapsed >= size) {
			return format.format(-Math.floor(elapsed / size), unit)
		}
	}
	return format.format(0, 'minute')
}
