/**
 * Display and input helpers for service levels: SLA durations (stored as
 * minutes) and service hours (one `HH:MM` window per ISO weekday).
 */
import { type ServiceWindow, WEEKDAYS, type Weekday } from 'shared/src/schemas'
import { locale, t } from '../i18n'

/** `90` → `1 h 30 min`; the form's duration parser reads it back. */
export function formatMinutes(minutes: number): string {
	const hours = Math.floor(minutes / 60)
	const rest = minutes % 60
	const parts: string[] = []
	if (hours > 0) {
		parts.push(t('duration.hours', { n: hours }))
	}
	if (rest > 0 || hours === 0) {
		parts.push(t('duration.minutes', { n: rest }))
	}
	return parts.join(' ')
}

/**
 * Minutes of a typed duration: `4h`, `30min`, `1 h 30 min`, `1:30`, or a
 * plain number of hours (`4`, `0.5`). Empty input is `null`, unparsable
 * input `undefined`.
 */
export function parseDuration(raw: string): number | null | undefined {
	const text = raw.trim().toLowerCase().replace(',', '.')
	if (text === '') {
		return null
	}
	const clock = /^(\d+):([0-5]\d)$/.exec(text)
	if (clock) {
		return positive(Number(clock[1]) * 60 + Number(clock[2]))
	}
	if (/^\d+(\.\d+)?$/.test(text)) {
		return positive(Math.round(Number(text) * 60))
	}
	const units = /^(?:(\d+(?:\.\d+)?)\s*(?:h|std)\.?)?\s*(?:(\d+)\s*(?:min|m)\.?)?$/.exec(text)
	if (units && (units[1] !== undefined || units[2] !== undefined)) {
		return positive(Math.round(Number(units[1] ?? 0) * 60) + Number(units[2] ?? 0))
	}
	return undefined
}

function positive(minutes: number): number | undefined {
	return minutes > 0 ? minutes : undefined
}

/** Short localized weekday name (`Mon` / `Mo`). */
export function weekdayLabel(day: Weekday, style: 'short' | 'long' = 'short'): string {
	// 2024-01-01 was a Monday, so day N falls on January N.
	return new Intl.DateTimeFormat(locale(), { weekday: style, timeZone: 'UTC' }).format(
		new Date(Date.UTC(2024, 0, day)),
	)
}

/**
 * Compact service hours: consecutive weekdays with the same window merge,
 * e.g. `Mon–Fri 08:00–17:00, Sat 09:00–12:00`. Empty for no windows.
 */
export function formatServiceHours(windows: readonly ServiceWindow[]): string {
	const byDay = new Map(windows.map((w) => [w.day, w]))
	const groups: { first: Weekday; last: Weekday; from: string; to: string }[] = []
	for (const day of WEEKDAYS) {
		const window = byDay.get(day)
		if (!window) {
			continue
		}
		const prev = groups.at(-1)
		if (prev && prev.last === day - 1 && prev.from === window.from && prev.to === window.to) {
			prev.last = day
		} else {
			groups.push({ first: day, last: day, from: window.from, to: window.to })
		}
	}
	return groups
		.map((g) => {
			const days =
				g.first === g.last
					? weekdayLabel(g.first)
					: `${weekdayLabel(g.first)}–${weekdayLabel(g.last)}`
			return `${days} ${g.from}–${g.to}`
		})
		.join(', ')
}
