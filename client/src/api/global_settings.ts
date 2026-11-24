/**
 * Global settings API wrappers (`settings.manage`): the settings row and the
 * model lists of the AI providers. Errors surface as `Result.err` with the
 * server's `{ error }` message.
 */
import type { Result } from 'better-result'
import type {
	AiModelJson,
	AiProvider,
	GlobalSettingsJson,
	GlobalSettingsUpdate,
} from 'shared/src/types'
import { t } from '../i18n'
import { client, to_result } from './client'

export type { AiModelJson, GlobalSettingsJson }

const api: (typeof client)['global-settings'] = client['global-settings']

export async function fetch_global_settings(): Promise<Result<GlobalSettingsJson, Error>> {
	const res = await api.$get()
	return to_result<GlobalSettingsJson>(res, t('globalSettings.loadFailed'))
}

export async function save_global_settings(
	input: GlobalSettingsUpdate,
): Promise<Result<GlobalSettingsJson, Error>> {
	const res = await api.$patch({ json: input })
	return to_result<GlobalSettingsJson>(res, t('globalSettings.saveFailed'))
}

/** Models `provider` offers with the server's credentials. */
export async function fetch_ai_models(provider: AiProvider): Promise<Result<AiModelJson[], Error>> {
	const res = await api['ai-models'].$get({ query: { provider } })
	return to_result<AiModelJson[]>(res, t('globalSettings.modelsFailed'))
}
