/**
 * TANSS support (appointment) → Outlook event content. Pure functions: no
 * I/O, so the event content and the change detection can be tested alone.
 */
import { createHash } from 'node:crypto'
import type { TnsSupportList } from 'tanss-api'
import { type GraphEvent, TANSS_CATEGORY, TANSS_ID_PROPERTY } from './graph'

/** One appointment as it should look in Outlook. */
export interface CalendarItem {
	/** Sync state key: the support id, or `<id>@<start>` for expanded recurrences. */
	key: string
	tanssId: number
	techId: number
	/** Unix seconds. */
	start: number
	end: number
	title: string
	location: string
	body: string
}

/** Names resolved from `meta.linkedEntities` of the list response. */
export interface LinkedNames {
	ticketTitles: Map<number, string>
	companyNames: Map<number, string>
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

/** `outlookTitle`, else `[#ticket] ticket title (company)`, else the first text line. */
function subjectOf(support: TnsSupportList, names: LinkedNames, company: string | null): string {
	const outlookTitle = text(support.outlookTitle)
	if (outlookTitle) {
		return outlookTitle
	}
	const ticketId = support.ticketId ? support.ticketId : null
	const parts: string[] = []
	if (ticketId !== null) {
		parts.push(`[#${ticketId}]`)
		const title = names.ticketTitles.get(ticketId)
		if (title) {
			parts.push(title)
		}
	}
	if (parts.length <= 1) {
		const firstLine = plainText(support.text ?? '')
			.split('\n')[0]
			?.trim()
		if (firstLine) {
			parts.push(firstLine.slice(0, 120))
		}
	}
	if (company) {
		parts.push(`(${company})`)
	}
	return parts.length > 0 ? parts.join(' ') : 'TANSS'
}

/**
 * `outlookLocation`, else the support location; on-site appointments name
 * the company (the list response carries no address).
 */
function locationOf(support: TnsSupportList, company: string | null): string {
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
 * Normalizes one support; null when it lacks an id, start or technician.
 * `key` defaults to the support id (see `CalendarItem.key`).
 */
export function toCalendarItem(
	support: TnsSupportList,
	names: LinkedNames,
	tanssBaseUrl: string,
	key: string = String(support.id),
): CalendarItem | null {
	if (!support.id || !support.date || !support.employeeId) {
		return null
	}
	const company = support.companyId ? (names.companyNames.get(support.companyId) ?? null) : null
	const minutes = Math.max(support.duration ?? 0, 0)
	return {
		key,
		tanssId: support.id,
		techId: support.employeeId,
		start: support.date,
		end: support.date + minutes * 60,
		title: subjectOf(support, names, company),
		location: locationOf(support, company),
		body: bodyOf(support, tanssBaseUrl),
	}
}

/** Change detection: covers every field written to Outlook. */
export function hash(item: CalendarItem): string {
	const { key, tanssId, start, end, title, location, body } = item
	return createHash('sha256')
		.update(JSON.stringify([key, tanssId, start, end, title, location, body]))
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
		showAs: 'busy',
		isReminderOn: false,
		categories: [TANSS_CATEGORY],
		singleValueExtendedProperties: [{ id: TANSS_ID_PROPERTY, value: item.key }],
	}
}
