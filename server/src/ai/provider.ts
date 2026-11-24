import { Result } from 'better-result'
import type { AiChatMessage, AiModelJson, AiProvider as AiProviderId } from 'shared/src/schemas'
import { type AppConfig, getConfig } from '../config'
import { ServiceUnavailableError } from '../db/errors'
import { getGlobalSettings } from '../db/global_settings'
import { createClaudeProvider, listClaudeModels } from './claude'
import { MOCK_MODELS, mockProvider } from './mock'
import { createOpencodeProvider, listOpencodeModels } from './opencode'

/** One stateless generation: the full conversation, oldest first. */
export interface AiRequest {
	system: string
	messages: readonly AiChatMessage[]
}

export interface AiReply {
	text: string
	/** Model that answered (may differ from the configured one after a fallback). */
	model: string
	/** Cut off at the output token limit. */
	truncated: boolean
}

/**
 * A backend that turns a conversation into the next assistant message.
 * Errors: `ExternalServiceError` (502) for provider failures,
 * `ValidationError` (422) when the model declines the request.
 */
export interface AiProvider {
	readonly id: AiProviderId | 'mock'
	/** Configured model; null when the provider picks its own default. */
	readonly model: string | null
	generate(req: AiRequest, signal?: AbortSignal): Promise<Result<AiReply, Error>>
}

/** One model a provider offers (`AiModelJson`). */
export type AiModel = AiModelJson

type AiConfig = NonNullable<AppConfig['ai']>

// Clients are built once per loaded config and model (tests swap the config object).
let cache: { config: AppConfig; model: string | null; provider: AiProvider } | null = null

/**
 * `[ai]` of the server config, unless no provider may be contacted: errs
 * with `ServiceUnavailableError` (503) when `[ai]` is missing or
 * `[integrations] mode = "offline"` (prompts can carry customer data, so
 * the safety switch covers them too). `mock` signals the mock mode.
 */
function aiConfig(): Result<AiConfig | 'mock', Error> {
	const config = getConfig()
	if (!config.ai) {
		return Result.err(
			new ServiceUnavailableError(
				'The AI assistant is not configured ([ai] in the server config)',
			),
		)
	}
	const mode = config.integrations.mode
	if (mode === 'offline') {
		return Result.err(
			new ServiceUnavailableError(
				'The AI provider is not contacted: integrations are offline ([integrations] mode)',
			),
		)
	}
	return Result.ok(mode === 'mock' ? 'mock' : config.ai)
}

/**
 * The configured provider with the default model of the global settings
 * (`/global-settings`), else the one of the server config. Errors as in
 * {@link aiConfig}; `mock` mode answers with canned replies instead of
 * contacting anyone.
 */
export async function getAiProvider(): Promise<Result<AiProvider, Error>> {
	const ai = aiConfig()
	if (Result.isError(ai)) {
		return ai
	}
	if (ai.value === 'mock') {
		return Result.ok(mockProvider)
	}
	const settings = await getGlobalSettings()
	if (Result.isError(settings)) {
		return settings
	}
	const { provider, claude, opencode } = ai.value
	const model =
		provider === 'claude'
			? (settings.value.ai_claude_model ?? claude.model)
			: (settings.value.ai_opencode_model ?? opencode.model ?? null)

	const config = getConfig()
	if (cache?.config === config && cache.model === model) {
		return Result.ok(cache.provider)
	}
	const created =
		provider === 'claude'
			? createClaudeProvider({ ...claude, model: model ?? claude.model })
			: createOpencodeProvider({ ...opencode, model: model ?? undefined })
	if (Result.isOk(created)) {
		cache = { config, model, provider: created.value }
	}
	return created
}

/**
 * Models `provider` offers with the credentials of the server config, for
 * picking the default model. Either provider can be listed, not only the
 * active one; errors as in {@link aiConfig}.
 */
export async function listAiModels(provider: AiProviderId): Promise<Result<AiModel[], Error>> {
	const ai = aiConfig()
	if (Result.isError(ai)) {
		return ai
	}
	if (ai.value === 'mock') {
		return Result.ok(MOCK_MODELS[provider])
	}
	return provider === 'claude'
		? listClaudeModels(ai.value.claude)
		: listOpencodeModels(ai.value.opencode)
}
