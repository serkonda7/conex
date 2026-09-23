import {
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
	remove: deleteSite,
	filters: (q: { group?: number }) => ({ group: q.group }),
})
