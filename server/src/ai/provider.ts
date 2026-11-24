import { Result } from 'better-result'
import type { AiChatMessage, AiProvider as AiProviderId } from 'shared/src/schemas'
import { type AppConfig, getConfig } from '../config'
import { ServiceUnavailableError } from '../db/errors'
import { createClaudeProvider } from './claude'
import { mockProvider } from './mock'
import { createOpencodeProvider } from './opencode'

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

// Clients are built once per loaded config (tests swap the config object).
let cache: { config: AppConfig; provider: AiProvider } | null = null

/**
 * The configured provider. Errs with `ServiceUnavailableError` (503) when
 * `[ai]` is missing or `[integrations] mode = "offline"` (prompts can carry
 * customer data, so the safety switch covers them too). `mock` mode answers
 * with canned replies instead of contacting anyone.
 */
export function getAiProvider(): Result<AiProvider, Error> {
	const config = getConfig()
	const ai = config.ai
	if (!ai) {
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
	if (mode === 'mock') {
		return Result.ok(mockProvider)
	}
	if (cache?.config === config) {
		return Result.ok(cache.provider)
	}

	const created =
		ai.provider === 'claude'
			? createClaudeProvider(ai.claude)
			: createOpencodeProvider(ai.opencode)
	if (Result.isOk(created)) {
		cache = { config, provider: created.value }
	}
	return created
}
