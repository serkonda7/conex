/**
 * TANSS support (appointment) → Outlook event content. Pure functions: no
 * I/O, so the event content and the change detection can be tested alone.
 */
import { createHash } from 'node:crypto'
import type { TnsSupportList } from 'tanss-api'
import { type GraphEvent, TANSS_CATEGORY, TANSS_ID_PROPERTY } from './graph'

/** One Outlook event: an appointment, an absence or a drive time. */
export interface CalendarItem {
	/**
	 * Sync state key: the support id, or `<id>@<start>` for expanded
	 * recurrences; drive times append `:approach` / `:departure`.
	 */
	key: string
	tanssId: number
	techId: number
	/** Unix seconds. */
	start: number
	end: number
	title: string
	location: string
	body: string
	/** Absences are shown as out of office, everything else as busy. */
	showAs: 'busy' | 'oof'
}

/**
 * Names resolved for the supports: company names from `meta.linkedEntities`
 * of the list response, ticket titles and company addresses fetched per id.
 */
export interface LinkedNames {
	ticketTitles: Map<number, string>
	companyNames: Map<number, string>
	companyAddresses: Map<number, string>
}

const LOCATION_LABELS: Record<string, string> = {
	OFFICE: 'Office',
	CUSTOMER: 'Customer',
	REMOTE: 'Remote',
}

function text(value: string | undefined | null): string | null {
	const trimmed = value?.trim()
	return trimmed ? trimmed : null
}

/** Support texts are HTML in TANSS; Outlook gets plain text. */
export function plainText(html: string): string {
	return html
		.replace(/<br\s*\/?>/gi, '\n')
		.replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
		.replace(/<[^>]*>/g, '')
		.replace(/&nbsp;/g, ' ')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&amp;/g, '&')
		.replace(/\n{3,}/g, '\n\n')
		.trim()
}

/** Subject fallback of an absence without text. */
const ABSENCE_SUBJECT = 'Absence'

/** Subjects of the drive time events. */
const APPROACH_TITLE = 'Anfahrt'
const DEPARTURE_TITLE = 'Abfahrt'

/**
 * `<company>: <ticket title> [#<ticket>]`. Without a ticket title the first
 * text line stands in for it; parts that are unknown are left out.
 */
function subjectOf(support: TnsSupportList, names: LinkedNames, company: string | null): string {
	const ticketId = support.ticketId ? support.ticketId : null
	let title = ticketId !== null ? text(names.ticketTitles.get(ticketId)) : null
	if (!title) {
		title =
			plainText(support.text ?? '')
				.split('\n')[0]
				?.trim()
				.slice(0, 120) || null
	}
	const parts: string[] = []
	if (title) {
		parts.push(title)
	}
	if (ticketId !== null) {
		parts.push(`[#${ticketId}]`)
	}
	const rest = parts.join(' ')
	if (company) {
		return rest ? `${company}: ${rest}` : company
	}
	return rest || (support.planningType === 'ABSENCE' ? ABSENCE_SUBJECT : 'TANSS')
}

/**
 * The company address, else `outlookLocation`, else the support location
 * (on-site appointments name the company).
 */
function locationOf(support: TnsSupportList, names: LinkedNames, company: string | null): string {
	const address = support.companyId ? text(names.companyAddresses.get(support.companyId)) : null
	if (address) {
		return address
	}
	const outlookLocation = text(support.outlookLocation)
	if (outlookLocation) {
		return outlookLocation
	}
	if (support.location === 'CUSTOMER' && company) {
		return company
	}
	return support.location ? (LOCATION_LABELS[support.location] ?? '') : ''
}

/** TANSS ticket link plus the support text. */
function bodyOf(support: TnsSupportList, tanssBaseUrl: string): string {
	const parts: string[] = []
	if (support.ticketId) {
		parts.push(`${tanssBaseUrl}/index.php?section=ticket&id=${support.ticketId}`)
	}
	const content = plainText(support.text ?? '')
	if (content) {
		parts.push(content)
	}
	return parts.join('\n\n')
}

/**
 * Normalizes one support into its event plus, for appointments, the drive
 * time before (`durationApproach`) and after (`durationDeparture`) as
 * separate events. Empty when it lacks an id, start or technician. `key`
 * defaults to the support id (see `CalendarItem.key`).
 */
export function toCalendarItems(
	support: TnsSupportList,
	names: LinkedNames,
	tanssBaseUrl: string,
	key: string = String(support.id),
): CalendarItem[] {
	if (!support.id || !support.date || !support.employeeId) {
		return []
	}
	const absence = support.planningType === 'ABSENCE'
	const company = support.companyId ? (names.companyNames.get(support.companyId) ?? null) : null
	const minutes = Math.max(support.duration ?? 0, 0)
	const main: CalendarItem = {
		key,
		tanssId: support.id,
		techId: support.employeeId,
		start: support.date,
		end: support.date + minutes * 60,
		title: subjectOf(support, names, company),
		location: absence ? '' : locationOf(support, names, company),
		body: bodyOf(support, tanssBaseUrl),
		showAs: absence ? 'oof' : 'busy',
	}
	if (absence) {
		return [main]
	}
	const items = [main]
	const approach = Math.max(support.durationApproach ?? 0, 0)
	if (approach > 0) {
		items.unshift({
			...main,
			key: `${key}:approach`,
			start: main.start - approach * 60,
			end: main.start,
			title: APPROACH_TITLE,
		})
	}
	const departure = Math.max(support.durationDeparture ?? 0, 0)
	if (departure > 0) {
		items.push({
			...main,
			key: `${key}:departure`,
			start: main.end,
			end: main.end + departure * 60,
			title: DEPARTURE_TITLE,
		})
	}
	return items
}

/** Change detection: covers every field written to Outlook. */
export function hash(item: CalendarItem): string {
	const { key, tanssId, start, end, title, location, body, showAs } = item
	return createHash('sha256')
		.update(JSON.stringify([key, tanssId, start, end, title, location, body, showAs]))
		.digest('hex')
}

/** Graph `dateTime` in UTC without offset (`2026-10-20T08:00:00`). */
function utcDateTime(unixSeconds: number): string {
	return new Date(unixSeconds * 1000).toISOString().slice(0, 19)
}

export function toGraphEvent(item: CalendarItem): GraphEvent {
	return {
		subject: item.title,
		body: { contentType: 'text', content: item.body },
		start: { dateTime: utcDateTime(item.start), timeZone: 'UTC' },
		end: { dateTime: utcDateTime(item.end), timeZone: 'UTC' },
		location: { displayName: item.location },
		showAs: item.showAs,
		isReminderOn: false,
		categories: [TANSS_CATEGORY],
		singleValueExtendedProperties: [{ id: TANSS_ID_PROPERTY, value: item.key }],
	}
}
