import { Result } from 'better-result'
import { eq } from 'drizzle-orm'
import type { GlobalSettingsJson, GlobalSettingsUpdate } from 'shared/src/schemas'
import { getConfig } from '../config'
import { global_settings } from '../schema'
import { nowSeconds } from '../util/time'
import { getDb } from './connection'
import { errOf, pickDefined, tryWrite } from './list'

/** The stored global settings; every field null until an admin saves one. */
export interface GlobalSettings {
	ai_claude_model: string | null
	ai_opencode_model: string | null
	billing_cutoff_day: number | null
	updated_at: number | null
}

const SETTINGS_ID = 1

const EMPTY: GlobalSettings = {
	ai_claude_model: null,
	ai_opencode_model: null,
	billing_cutoff_day: null,
	updated_at: null,
}

/** Reads the settings row; defaults when none was saved yet. */
export async function getGlobalSettings(): Promise<Result<GlobalSettings, Error>> {
	try {
		const row = (
			await getDb()
				.select()
				.from(global_settings)
				.where(eq(global_settings.id, SETTINGS_ID))
				.limit(1)
		)[0]
		return Result.ok(
			row
				? {
						ai_claude_model: row.ai_claude_model,
						ai_opencode_model: row.ai_opencode_model,
						billing_cutoff_day: row.billing_cutoff_day,
						updated_at: row.updated_at,
					}
				: EMPTY,
		)
	} catch (err) {
		return Result.err(errOf(err))
	}
}

/** Writes the given fields (`null` clears one) and returns the new state. */
export async function updateGlobalSettings(
	input: GlobalSettingsUpdate,
): Promise<Result<GlobalSettings, Error>> {
	const values = {
		...pickDefined(input, ['ai_claude_model', 'ai_opencode_model', 'billing_cutoff_day']),
		updated_at: nowSeconds(),
	}
	const saved = await tryWrite(() =>
		getDb()
			.insert(global_settings)
			.values({ id: SETTINGS_ID, ...values })
			.onConflictDoUpdate({ target: global_settings.id, set: values }),
	)
	if (Result.isError(saved)) {
		return saved
	}
	return getGlobalSettings()
}

/** API shape: the stored values next to the server config they override. */
export function globalSettingsJson(settings: GlobalSettings): GlobalSettingsJson {
	const ai = getConfig().ai
	return {
		ai_claude_model: settings.ai_claude_model,
		ai_opencode_model: settings.ai_opencode_model,
		billing_cutoff_day: settings.billing_cutoff_day,
		config: {
			ai_provider: ai?.provider ?? null,
			ai_claude_model: ai?.claude.model ?? null,
			ai_opencode_model: ai?.opencode.model ?? null,
		},
		updated_at: settings.updated_at,
	}
}
