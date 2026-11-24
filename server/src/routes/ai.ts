import { vValidator } from '@hono/valibot-validator'
import { Result } from 'better-result'
import { type Context, Hono } from 'hono'
import { type AiChatReplyJson, AiChatSchema, type AiStatusJson } from 'shared/src/schemas'
import { ASSISTANT_SYSTEM_PROMPT } from '../ai/prompt'
import { getAiProvider } from '../ai/provider'
import { getConfig } from '../config'
import { authMiddleware } from '../middleware/auth'
import { requirePermissionMiddleware } from '../middleware/permissions'
import { user_rate_limit } from '../middleware/rate_limit'
import { onValidationError } from '../middleware/validation'
import { sendResult } from '../util/result_response'

const DEFAULT_LIMITS = { maxRequests: 30, windowSeconds: 300 }

/**
 * Lifts Bun's idle timeout (10 s) for this request: a model reply can take
 * minutes before the first byte is sent. No-op outside `Bun.serve`.
 */
function allowSlowResponse(c: Context): void {
	const server = c.env as { timeout?: (req: Request, seconds: number) => void } | undefined
	server?.timeout?.(c.req.raw, 0)
}

/**
 * In-app AI assistant (`ai.use`). Stateless: the client sends the whole
 * conversation each turn; nothing is stored.
 */
export const aiApp = new Hono()
	.use(authMiddleware)
	.use(requirePermissionMiddleware('ai.use'))
	.get('/status', async (c) => {
		const provider = await getAiProvider()
		const status: AiStatusJson = Result.isOk(provider)
			? { enabled: true, provider: provider.value.id, model: provider.value.model }
			: { enabled: false, provider: getConfig().ai?.provider ?? null, model: null }
		return c.json(status)
	})
	.post(
		'/chat',
		user_rate_limit(() => getConfig().ai?.rateLimit ?? DEFAULT_LIMITS),
		vValidator('json', AiChatSchema, onValidationError),
		async (c) => {
			const provider = await getAiProvider()
			if (Result.isError(provider)) {
				return sendResult(c, provider)
			}
			allowSlowResponse(c)
			const { id } = provider.value
			// Aborted with the request, so a closed tab stops the (billed) generation.
			const reply = await provider.value.generate(
				{ system: ASSISTANT_SYSTEM_PROMPT, messages: c.req.valid('json').messages },
				c.req.raw.signal,
			)
			return sendResult(
				c,
				reply.map(
					(r): AiChatReplyJson => ({
						text: r.text,
						provider: id,
						model: r.model,
						truncated: r.truncated,
					}),
				),
			)
		},
	)
