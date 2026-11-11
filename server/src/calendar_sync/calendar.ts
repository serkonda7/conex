/**
 * Calendar calls of the calendar sync on top of the shared Graph client.
 * The app registration needs the application permission
 * `Calendars.ReadWrite` (scoped to the technicians' mailboxes).
 */
import '@microsoft/msgraph-sdk-users'
import { Result } from 'better-result'
import { GraphApiError, type GraphClient } from '../microsoft/graph'

/** Fixed property set of the `conexTanssId` extended property. */
export const TANSS_ID_PROPERTY = 'String {5b0f9a3e-6c1d-4f4e-9a8b-2f1c7d3e8a51} Name conexTanssId'

/** Category on every synced event. */
export const TANSS_CATEGORY = 'TANSS'

/** The `event` resource fields the sync writes (a subset of the SDK's `Event`). */
export interface GraphEvent {
	subject: string
	body: { contentType: 'text' | 'html'; content: string }
	/** `dateTime` without offset, interpreted in `timeZone`. */
	start: { dateTime: string; timeZone: 'UTC' }
	end: { dateTime: string; timeZone: 'UTC' }
	location: { displayName: string }
	showAs: 'busy' | 'oof'
	isReminderOn: boolean
	categories: string[]
	singleValueExtendedProperties: { id: string; value: string }[]
}

/** Main-calendar operations on the mailboxes of one Entra tenant. */
export class CalendarClient {
	constructor(readonly graph: GraphClient) {}

	/** Reads the mailbox's main calendar: proves permission and scoping for `upn`. */
	async verify(upn: string): Promise<Result<void, Error>> {
		const res = await this.graph.call(`calendar check for ${upn}`, (api) =>
			api.users.byUserId(upn).calendar.get({ queryParameters: { select: ['id'] } }),
		)
		return res.map(() => undefined)
	}

	/** Creates an event in the main calendar and returns its id. */
	async createEvent(upn: string, event: GraphEvent): Promise<Result<string, Error>> {
		const res = await this.graph.call(`event create for ${upn}`, (api) =>
			api.users.byUserId(upn).events.post(event),
		)
		if (Result.isError(res)) {
			return res
		}
		const id = res.value?.id
		if (!id) {
			return Result.err(
				new GraphApiError('Microsoft Graph event create returned no event id', null),
			)
		}
		return Result.ok(id)
	}

	/** Overwrites the given event fields; 404 when the user deleted the event. */
	async updateEvent(
		upn: string,
		eventId: string,
		event: GraphEvent,
	): Promise<Result<void, Error>> {
		const res = await this.graph.call(`event update for ${upn}`, (api) =>
			api.users.byUserId(upn).events.byEventId(eventId).patch(event),
		)
		return res.map(() => undefined)
	}

	async deleteEvent(upn: string, eventId: string): Promise<Result<void, Error>> {
		const res = await this.graph.call(`event delete for ${upn}`, (api) =>
			api.users.byUserId(upn).events.byEventId(eventId).delete(),
		)
		return res.map(() => undefined)
	}
}
