import { vValidator } from '@hono/valibot-validator'
import { Result } from 'better-result'
import {
	EntityParamsSchema,
	RackCreateSchema,
	RackListQuerySchema,
	RackUpdateSchema,
} from 'shared/src/schemas'
import { checkRead } from '../authz'
import { createRack, deleteRack, getElevation, getRack, listRacks, updateRack } from '../db/racks'
import { onValidationError } from '../middleware/validation'
import { sendResult } from '../util/result_response'
import { makeTenantApp } from './crud'

const baseRacksApp = makeTenantApp({
	listQuerySchema: RackListQuerySchema,
	createSchema: RackCreateSchema,
	updateSchema: RackUpdateSchema,
	paramSchema: EntityParamsSchema,
	list: listRacks,
	create: createRack,
	get: getRack,
	update: updateRack,
	remove: deleteRack,
	filters: (q: { site?: number; location?: number }) => ({ site: q.site, location: q.location }),
})

export const racksApp = baseRacksApp.get(
	'/:id/elevation',
	vValidator('param', EntityParamsSchema, onValidationError),
	(c) => {
		const rack = getRack(c.req.valid('param').id)
		if (Result.isError(rack)) {
			return sendResult(c, rack)
		}
		const denied = checkRead(c, rack.value.tenant_id)
		if (denied) {
			return denied
		}
		return sendResult(c, getElevation(c.req.valid('param').id))
	},
)
