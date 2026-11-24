import { Result } from 'better-result'
import type { AiModel, AiProvider, AiReply, AiRequest } from './provider'

/**
 * Canned replies for `[integrations] mode = "mock"` (development, e2e):
 * echoes the last user message, contacts nobody and costs nothing.
 */
export const mockProvider: AiProvider = {
	id: 'mock',
	model: 'mock',
	generate(req: AiRequest): Promise<Result<AiReply, Error>> {
		const last = req.messages.at(-1)?.text ?? ''
		return Promise.resolve(
			Result.ok({
				text: `Mock reply (integrations are mocked). You wrote:\n\n> ${last.slice(0, 500).replaceAll('\n', '\n> ')}`,
				model: 'mock',
				truncated: false,
			}),
		)
	},
}

/** Model lists of the mock mode, so the settings page works without a provider. */
export const MOCK_MODELS: Record<'claude' | 'opencode', AiModel[]> = {
	claude: [
		{ id: 'claude-opus-5-5', name: 'Claude Opus 5.5' },
		{ id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5' },
		{ id: 'claude-haiku-5-5', name: 'Claude Haiku 5.5' },
	],
	opencode: [
		{ id: 'anthropic/claude-opus-5-5', name: 'Claude Opus 5.5' },
		{ id: 'anthropic/claude-sonnet-5-5', name: 'Claude Sonnet 5.5' },
	],
}
