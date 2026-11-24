/**
 * Billing period calendar. A period is a month (`YYYY-MM`) that ends at the
 * cutoff: midnight after the cutoff day (or after the month's last day when
 * no day is set), Europe/Berlin. Pure functions, so the calendar stays
 * testable without a database.
 */

/** Time zone the cutoff midnight is read in. */
export const BILLING_TIME_ZONE = 'Europe/Berlin'

/** How long after its cutoff a period is still snapshotted automatically. */
export const AUTO_SNAPSHOT_GRACE_S = 7 * 24 * 60 * 60

/** Offset of `tz` from UTC at `ms`, in milliseconds. */
function zoneOffsetMs(ms: number, tz: string): number {
	const parts = new Intl.DateTimeFormat('en-US', {
		timeZone: tz,
		hourCycle: 'h23',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
	}).formatToParts(new Date(ms))
	const part = (type: Intl.DateTimeFormatPartTypes): number =>
		Number(parts.find((p) => p.type === type)?.value ?? 0)
	const local = Date.UTC(
		part('year'),
		part('month') - 1,
		part('day'),
		part('hour'),
		part('minute'),
		part('second'),
	)
	return local - (ms - (ms % 1000))
}

/**
 * Unix seconds of local midnight starting `day` of `month` (1-based) in `tz`.
 * Days and months past the end roll over like `Date.UTC`.
 */
function zonedMidnight(year: number, month: number, day: number, tz: string): number {
	const guess = Date.UTC(year, month - 1, day)
	let ms = guess - zoneOffsetMs(guess, tz)
	// Across a DST switch the offset at the result differs from the guess's.
	const corrected = guess - zoneOffsetMs(ms, tz)
	if (corrected !== ms) {
		ms = corrected
	}
	return Math.floor(ms / 1000)
}

function parsePeriod(period: string): { year: number; month: number } {
	const [year, month] = period.split('-').map(Number)
	return { year: year ?? 1970, month: month ?? 1 }
}

function formatPeriod(year: number, month: number): string {
	const date = new Date(Date.UTC(year, month - 1, 1))
	return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

/** The month `delta` months from `period`. */
export function shiftPeriod(period: string, delta: number): string {
	const { year, month } = parsePeriod(period)
	return formatPeriod(year, month + delta)
}

/** Unix seconds at which `period` ends. */
export function cutoffAt(period: string, cutoffDay: number | null): number {
	const { year, month } = parsePeriod(period)
	return cutoffDay === null
		? zonedMidnight(year, month + 1, 1, BILLING_TIME_ZONE)
		: zonedMidnight(year, month, cutoffDay + 1, BILLING_TIME_ZONE)
}

/** Calendar month of `nowS` in the billing time zone. */
function localPeriod(nowS: number): string {
	const parts = new Intl.DateTimeFormat('en-CA', {
		timeZone: BILLING_TIME_ZONE,
		year: 'numeric',
		month: '2-digit',
	}).formatToParts(new Date(nowS * 1000))
	const year = parts.find((p) => p.type === 'year')?.value ?? '1970'
	const month = parts.find((p) => p.type === 'month')?.value ?? '01'
	return `${year}-${month}`
}

/** The period running at `nowS`: the first whose cutoff lies ahead. */
export function currentPeriod(nowS: number, cutoffDay: number | null): string {
	let period = localPeriod(nowS)
	// A cutoff before the month's end moves the rest of the month on.
	while (cutoffAt(period, cutoffDay) <= nowS) {
		period = shiftPeriod(period, 1)
	}
	return period
}

/** The latest period whose cutoff has passed at `nowS`. */
export function duePeriod(nowS: number, cutoffDay: number | null): string {
	return shiftPeriod(currentPeriod(nowS, cutoffDay), -1)
}
