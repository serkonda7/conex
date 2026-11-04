/**
 * Calendar sync API wrappers (TANSS appointments → Outlook): settings,
 * technician mappings and runs. Errors surface as `Result.err` with the
 * server's `{ error }` message.
 */
import { Result } from 'better-result'
import type {
	CalendarMapping,
	CalendarMappingJson,
	CalendarSyncConfig,
	CalendarSyncConfigJson,
	CalendarSyncRunJson,
	CalendarSyncTest,
	CalendarTechnicianJson,
} from 'shared/src/types'
import { t } from '../i18n'
import { client, to_result } from './client'

export type { CalendarSyncConfigJson, CalendarSyncRunJson, CalendarTechnicianJson }

const api: (typeof client)['calendar-sync'] = client['calendar-sync']

export async function fetch_calendar_sync_config(): Promise<Result<CalendarSyncConfigJson, Error>> {
	const res = await api.config.$get()
	return to_result<CalendarSyncConfigJson>(res, t('calendarSync.loadFailed'))
}

export async function save_calendar_sync_config(
	input: CalendarSyncConfig,
): Promise<Result<CalendarSyncConfigJson, Error>> {
	const res = await api.config.$put({ json: input })
	return to_result<CalendarSyncConfigJson>(res, t('calendarSync.saveFailed'))
}

export async function test_calendar_sync_config(
	input: CalendarSyncTest,
): Promise<Result<unknown, Error>> {
	const res = await api.config.test.$post({ json: input })
	return to_result<unknown>(res, t('calendarSync.testFailed'))
}

export async function fetch_calendar_technicians(): Promise<
	Result<CalendarTechnicianJson[], Error>
> {
	const res = await api.technicians.$get()
	return to_result<CalendarTechnicianJson[]>(res, t('calendarSync.techniciansFailed'))
}

export async function save_calendar_mapping(
	tanssEmployeeId: number,
	input: CalendarMapping,
): Promise<Result<CalendarMappingJson, Error>> {
	const res = await api.mappings[':tanssEmployeeId'].$put({
		param: { tanssEmployeeId: String(tanssEmployeeId) },
		json: input,
	})
	return to_result<CalendarMappingJson>(res, t('calendarSync.mappingFailed'))
}

export async function delete_calendar_mapping(
	tanssEmployeeId: number,
): Promise<Result<CalendarMappingJson, Error>> {
	const res = await api.mappings[':tanssEmployeeId'].$delete({
		param: { tanssEmployeeId: String(tanssEmployeeId) },
	})
	return to_result<CalendarMappingJson>(res, t('calendarSync.mappingFailed'))
}

export async function fetch_calendar_sync_runs(): Promise<Result<CalendarSyncRunJson[], Error>> {
	const res = await api.runs.$get()
	return to_result<CalendarSyncRunJson[]>(res, t('calendarSync.runsFailed'))
}

export async function start_calendar_sync(): Promise<Result<CalendarSyncRunJson, Error>> {
	const res = await api.run.$post()
	return to_result<CalendarSyncRunJson>(res, t('calendarSync.syncFailed'))
}

/** Polls the run list until run `id` leaves `running` (1.5 s steps). */
export async function wait_for_calendar_sync(
	id: number,
): Promise<Result<CalendarSyncRunJson, Error>> {
	for (;;) {
		await new Promise((resolve) => setTimeout(resolve, 1500))
		const res = await fetch_calendar_sync_runs()
		if (Result.isError(res)) {
			return res
		}
		const run = res.value.find((r) => r.id === id)
		if (!run) {
			return Result.err(new Error(t('calendarSync.syncFailed')))
		}
		if (run.state !== 'running') {
			return Result.ok(run)
		}
	}
}
