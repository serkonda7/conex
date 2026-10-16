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

export type DurationUnit = 'days' | 'hours' | 'minutes'

export const DURATION_UNITS: readonly DurationUnit[] = ['days', 'hours', 'minutes']

const UNIT_MINUTES: Record<DurationUnit, number> = { days: 1440, hours: 60, minutes: 1 }

/** `90` → `{ value: '90', unit: 'minutes' }`; the largest unit that divides evenly. */
export function splitMinutes(minutes: number): { value: string; unit: DurationUnit } {
	const unit = DURATION_UNITS.find((u) => minutes % UNIT_MINUTES[u] === 0) ?? 'minutes'
	return { value: String(minutes / UNIT_MINUTES[unit]), unit }
}

/**
 * Minutes of a typed whole number in `unit`. Empty input is `null`, anything
 * that is not a positive whole number `undefined`.
 */
export function toMinutes(raw: string, unit: DurationUnit): number | null | undefined {
	const text = raw.trim()
	if (text === '') {
		return null
	}
	const n = Number(text)
	return Number.isInteger(n) && n > 0 ? n * UNIT_MINUTES[unit] : undefined
}

/** Short localized weekday name (`Mon` / `Mo`). */
export function weekdayLabel(day: Weekday, style: 'short' | 'long' = 'short'): string {
	// 2024-01-01 was a Monday, so day N falls on January N.
	return new Intl.DateTimeFormat(locale(), { weekday: style, timeZone: 'UTC' }).format(
		new Date(Date.UTC(2024, 0, day)),
	)
}

/** `08:00–17:00`, or `24 hours` for a window without start and end. */
export function formatWindow(window: Pick<ServiceWindow, 'from' | 'to'>): string {
	return window.from === '' ? t('serviceLevel.allDay') : `${window.from}–${window.to}`
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
			return `${days} ${formatWindow(g)}`
		})
		.join(', ')
}
