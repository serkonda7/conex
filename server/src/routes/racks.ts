import { vValidator } from '@hono/valibot-validator'
import {
	EntityParamsSchema,
	RackCreateSchema,
	RackListQuerySchema,
	RackUpdateSchema,
} from 'shared/src/schemas'
import { checkTenant } from '../authz'
import { rackTenant } from '../db/owners'
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
		// A missing rack passes the gate and answers 404 from `getElevation`.
		return checkTenant(c, await rackTenant(id)) ?? sendResult(c, await getElevation(id))
	},
)
