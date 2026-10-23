import { vValidator } from '@hono/valibot-validator'
import { Result } from 'better-result'
import {
	type DeleteQuery,
	EntityParamsSchema,
	LocationCreateSchema,
	LocationListQuerySchema,
	LocationUpdateSchema,
} from 'shared/src/schemas'
import { checkTenant, requestScope } from '../authz'
import { listLocationOutlets } from '../db/devices'
import {
	createLocation,
	deleteLocation,
	getLocation,
	listLocations,
	updateLocation,
} from '../db/tenancy'
import { onValidationError } from '../middleware/validation'
import { sendResult } from '../util/result_response'
import { makeTenantApp } from './crud'

const baseLocationsApp = makeTenantApp({
	listQuerySchema: LocationListQuerySchema,
	createSchema: LocationCreateSchema,
	updateSchema: LocationUpdateSchema,
	paramSchema: EntityParamsSchema,
	list: listLocations,
	create: createLocation,
	get: getLocation,
	update: updateLocation,
	remove: (id: number, query: DeleteQuery) => deleteLocation(id, query.confirm === 'floorplan'),
	filters: (q: { site?: number[]; parent?: number }) => ({ site: q.site, parent: q.parent }),
})

/** Outlets in the location or its descendants, on panels the requester may see. */
export const locationsApp = baseLocationsApp.get(
	'/:id/outlets',
	vValidator('param', EntityParamsSchema, onValidationError),
	async (c) => {
		const id = c.req.valid('param').id
		const location = await getLocation(id)
		if (Result.isError(location)) {
			return sendResult(c, location)
		}
		return (
			checkTenant(c, location.value.tenant_id) ??
			c.json(await listLocationOutlets(id, requestScope(c)))
		)
	},
)
