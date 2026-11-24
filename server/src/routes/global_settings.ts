import { vValidator } from '@hono/valibot-validator'
import { Hono } from 'hono'
import { AiModelListQuerySchema, GlobalSettingsUpdateSchema } from 'shared/src/schemas'
import { listAiModels } from '../ai/provider'
import { getGlobalSettings, globalSettingsJson, updateGlobalSettings } from '../db/global_settings'
import { authMiddleware } from '../middleware/auth'
import { requireGlobalPermissionMiddleware } from '../middleware/permissions'
import { onValidationError } from '../middleware/validation'
import { sendResult } from '../util/result_response'

/**
 * Global settings of the installation (`settings.manage`, global accounts
 * only): the default AI models per provider, which override the server
 * config while set.
 */
export const globalSettingsApp = new Hono()
	.use(authMiddleware)
	.use(requireGlobalPermissionMiddleware('settings.manage'))
	.get('/', async (c) => sendResult(c, (await getGlobalSettings()).map(globalSettingsJson)))
	.patch('/', vValidator('json', GlobalSettingsUpdateSchema, onValidationError), async (c) =>
		sendResult(c, (await updateGlobalSettings(c.req.valid('json'))).map(globalSettingsJson)),
	)
	// Choices for the model pickers, read from the provider itself.
	.get('/ai-models', vValidator('query', AiModelListQuerySchema, onValidationError), async (c) =>
		sendResult(c, await listAiModels(c.req.valid('query').provider)),
	)
