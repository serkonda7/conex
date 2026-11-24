import Anthropic from '@anthropic-ai/sdk'
import { Result } from 'better-result'
import type { AppConfig } from '../config'
import { ExternalServiceError, ValidationError } from '../db/errors'
import type { AiProvider, AiReply, AiRequest } from './provider'

type ClaudeConfig = NonNullable<AppConfig['ai']>['claude']

// Models that accept server-side refusal fallbacks (`fallbacks: "default"`).
const FALLBACK_MODELS = new Set([
	'claude-fable-5-2',
	'claude-fable-5-1',
	'claude-opus-5-5',
	'claude-opus-5',
	'claude-sonnet-5-5',
])

/**
 * Claude through the Messages API. Credentials: `apiKey` from the config,
 * else the SDK's own lookup (`ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`,
 * an `ant auth login` profile). Streams internally so long replies do not
 * hit HTTP timeouts, and returns the final message.
 */
export function createClaudeProvider(cfg: ClaudeConfig): Result<AiProvider, Error> {
	let client: Anthropic
	try {
		client = new Anthropic(cfg.apiKey ? { apiKey: cfg.apiKey } : {})
	} catch (err) {
		return Result.err(
			new ExternalServiceError(`Claude client could not be created: ${errorMessage(err)}`),
		)
	}
	const fallback = FALLBACK_MODELS.has(cfg.model)

	return Result.ok({
		id: 'claude',
		model: cfg.model,
		async generate(req: AiRequest, signal?: AbortSignal): Promise<Result<AiReply, Error>> {
			try {
				const message = await client.beta.messages
					.stream(
						{
							model: cfg.model,
							max_tokens: cfg.maxTokens,
							system: req.system,
							messages: req.messages.map((m) => ({ role: m.role, content: m.text })),
							...(cfg.effort && { output_config: { effort: cfg.effort } }),
							// A declined request is retried on a fallback model in the same call.
							...(fallback && {
								betas: ['server-side-fallback-2026-07-01'],
								fallbacks: 'default' as const,
							}),
						},
						{ signal },
					)
					.finalMessage()

				if (message.stop_reason === 'refusal') {
					return Result.err(new ValidationError('The AI declined this request'))
				}
				const text = message.content
					.flatMap((block) => (block.type === 'text' ? [block.text] : []))
					.join('')
				return Result.ok({
					text,
					model: message.model,
					truncated: message.stop_reason === 'max_tokens',
				})
			} catch (err) {
				return Result.err(claudeError(err))
			}
		},
	})
}

function claudeError(err: unknown): Error {
	if (err instanceof Anthropic.APIUserAbortError) {
		return new Error('Claude request aborted')
	}
	if (err instanceof Anthropic.APIConnectionError) {
		return new ExternalServiceError('Claude API is unreachable')
	}
	if (err instanceof Anthropic.AuthenticationError) {
		return new ExternalServiceError('Claude API rejected the credentials')
	}
	if (err instanceof Anthropic.RateLimitError) {
		return new ExternalServiceError('Claude API rate limit reached, try again later')
	}
	if (err instanceof Anthropic.APIError) {
		return new ExternalServiceError(
			`Claude API error ${err.status ?? ''}: ${err.message}`.trim(),
		)
	}
	return new ExternalServiceError(`Claude request failed: ${errorMessage(err)}`)
}

function errorMessage(err: unknown): string {
	return err instanceof Error ? err.message : String(err)
}
