import {
	type DeleteQuery,
	EntityParamsSchema,
	SiteCreateSchema,
	SiteListQuerySchema,
	SiteUpdateSchema,
} from 'shared/src/schemas'
import { createSite, deleteSite, getSite, listSites, updateSite } from '../db/tenancy'
import { makeTenantApp } from './crud'

export const sitesApp = makeTenantApp({
	listQuerySchema: SiteListQuerySchema,
	createSchema: SiteCreateSchema,
	updateSchema: SiteUpdateSchema,
	paramSchema: EntityParamsSchema,
	list: listSites,
	create: createSite,
	get: getSite,
	update: updateSite,
	remove: (id: number, query: DeleteQuery) => deleteSite(id, query.confirm === 'floorplan'),
	filters: (q: { group?: number }) => ({ group: q.group }),
})
