import { vValidator } from '@hono/valibot-validator'
import { Result } from 'better-result'
import {
	EntityParamsSchema,
	RackCreateSchema,
	RackListQuerySchema,
	RackUpdateSchema,
} from 'shared/src/schemas'
import { checkTenant } from '../authz'
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
	filters: (q: { site?: number[]; location?: number[]; rack_type?: number[] }) => ({
		site: q.site,
		location: q.location,
		rack_type: q.rack_type,
	}),
})

export const racksApp = baseRacksApp.get(
	'/:id/elevation',
	vValidator('param', EntityParamsSchema, onValidationError),
	async (c) => {
		const id = c.req.valid('param').id
		const rack = await getRack(id)
		if (Result.isError(rack)) {
			return sendResult(c, rack)
		}
		return checkTenant(c, rack.value.tenant_id) ?? sendResult(c, await getElevation(id))
	},
)
