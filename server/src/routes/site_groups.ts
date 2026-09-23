import {
	EntityParamsSchema,
	SiteGroupCreateSchema,
	SiteGroupListQuerySchema,
	SiteGroupUpdateSchema,
} from 'shared/src/schemas'
import {
	createSiteGroup,
	deleteSiteGroup,
	getSiteGroup,
	listSiteGroups,
	updateSiteGroup,
} from '../db/tenancy'
import { makeTenantApp } from './crud'

export const siteGroupsApp = makeTenantApp({
	listQuerySchema: SiteGroupListQuerySchema,
	createSchema: SiteGroupCreateSchema,
	updateSchema: SiteGroupUpdateSchema,
	paramSchema: EntityParamsSchema,
	list: listSiteGroups,
	create: createSiteGroup,
	get: getSiteGroup,
	update: updateSiteGroup,
	remove: deleteSiteGroup,
	filters: (q: { parent?: number }) => ({ parent: q.parent }),
})
