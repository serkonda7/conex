import { Result } from 'better-result'
import type { AiProvider, AiReply, AiRequest } from './provider'

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
