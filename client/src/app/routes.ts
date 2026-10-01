/**
 * Route table: one entry per top-level URL section. The route parser, the
 * page switch, the sidebar and the tab titles are all derived from it, so a
 * new entity only needs a row here.
 *
 * URL shape per section: `/<path>` (list), `/<path>/add`, `/<path>/import`,
 * `/<path>/:id` (detail) and `/<path>/:id/edit`. A kind without a page
 * resolves to not-found.
 */
import {
	IconBox,
	IconBuildingFactory,
	IconBuildingSkyscraper,
	IconCpu,
	IconFolder,
	IconHistory,
	IconLayoutDashboard,
	IconListDetails,
	IconLocation,
	IconLock,
	IconMapPin,
	IconNetwork,
	IconPlugConnected,
	IconServer,
	IconShieldLock,
	IconTag,
	IconTemplate,
	IconUsers,
} from '@tabler/icons-solidjs'
import type { Permission } from 'shared/src/types'
import type { Component } from 'solid-js'
import { t, tp } from '../i18n'
import { type Crumb, pageMetaFor, parseId, routeSegments } from '../lib/router'
import { can } from '../lib/session'
import { AuditLogPage } from '../pages/audit_log/list'
import { ChangeDetailPage } from '../pages/changelog/detail'
import { ChangelogPage } from '../pages/changelog/list'
import { DashboardPage } from '../pages/dashboard/view'
import { DeviceTypeDetailPage } from '../pages/device_types/detail'
import { DeviceTypeAddPage, DeviceTypeEditPage } from '../pages/device_types/form'
import { DeviceTypeImportPage } from '../pages/device_types/import'
import { DeviceTypesPage } from '../pages/device_types/list'
import { DeviceRoleDetailPage } from '../pages/device-roles/detail'
import { DeviceRoleAddPage, DeviceRoleEditPage } from '../pages/device-roles/form'
import { DeviceRolesPage } from '../pages/device-roles/list'
import { DeviceAddPage } from '../pages/devices/add'
import { DeviceDetailPage } from '../pages/devices/detail'
import { DeviceEditPage } from '../pages/devices/edit'
import { DevicesPage } from '../pages/devices/list'
import { IntegrationAddPage } from '../pages/integrations/add'
import { IntegrationEditPage } from '../pages/integrations/edit'
import { IntegrationsPage } from '../pages/integrations/list'
import { IntegrationReportPage } from '../pages/integrations/report'
import { LocationAddPage } from '../pages/locations/add'
import { LocationDetailPage } from '../pages/locations/detail'
import { LocationEditPage } from '../pages/locations/edit'
import { LocationsPage } from '../pages/locations/list'
import { ManufacturerDetailPage } from '../pages/manufacturers/detail'
import { ManufacturerAddPage, ManufacturerEditPage } from '../pages/manufacturers/form'
import { ManufacturersPage } from '../pages/manufacturers/list'
import { RackTypeAddPage } from '../pages/rack_types/add'
import { RackTypesPage } from '../pages/rack_types/list'
import { RackAddPage } from '../pages/racks/add'
import { RackDetailPage } from '../pages/racks/detail'
import { RackEditPage } from '../pages/racks/edit'
import { RacksPage } from '../pages/racks/list'
import { RoleAddPage, RoleEditPage } from '../pages/roles/form'
import { RolesPage } from '../pages/roles/list'
import { ShelfAddPage, ShelfEditPage } from '../pages/shelves/form'
import { SiteGroupDetailPage } from '../pages/site_groups/detail'
import { SiteGroupAddPage, SiteGroupEditPage } from '../pages/site_groups/form'
import { SiteGroupsPage } from '../pages/site_groups/list'
import { SiteDetailPage } from '../pages/sites/detail'
import { SiteAddPage, SiteEditPage } from '../pages/sites/form'
import { SitesPage } from '../pages/sites/list'
import { TenantGroupDetailPage } from '../pages/tenant_groups/detail'
import { TenantGroupAddPage, TenantGroupEditPage } from '../pages/tenant_groups/form'
import { TenantGroupsPage } from '../pages/tenant_groups/list'
import { TenantDetailPage } from '../pages/tenants/detail'
import { TenantAddPage, TenantEditPage } from '../pages/tenants/form'
import { TenantsPage } from '../pages/tenants/list'
import { TicketAddPage } from '../pages/tickets/add'
import { TopologyPage } from '../pages/topology/view'
import { UserAddPage } from '../pages/users/add'
import { UserEditPage } from '../pages/users/edit'
import { UsersPage } from '../pages/users/list'

export interface Section {
	/** First URL segment (`/devices/…`). */
	path: string
	/** Legacy segments resolving to the same section. */
	aliases?: readonly string[]
	/** Localized entity name for tab titles and the sidebar. */
	noun: (count: number) => string
	/** Sidebar icon; sections without one (or without a list) stay hidden. */
	icon?: Component<{ size?: number }>
	/** Permission needed to open the section (and see it in the sidebar); `null` = none. */
	permission: Permission | null
	/** Routed but left out of the sidebar (reached another way). */
	hideInNav?: boolean
	/** No sidebar "+" shortcut (the add page is reached from the list). */
	hideAddInNav?: boolean
	list?: Component
	add?: Component
	import?: Component
	detail?: Component<{ id: number }>
	edit?: Component<{ id: number }>
}

/** Every routed section; the first one is the home page. Sidebar grouping lives in `sidebar.tsx`. */
export const SECTIONS: readonly Section[] = [
	{
		path: 'dashboard',
		noun: (): string => t('entity.dashboard'),
		icon: IconLayoutDashboard,
		permission: null,
		hideAddInNav: true,
		list: DashboardPage,
	},
	{
		path: 'tenants',
		noun: (n: number): string => tp('entity.tenant', n),
		permission: 'view',
		icon: IconUsers,
		list: TenantsPage,
		add: TenantAddPage,
		detail: TenantDetailPage,
		edit: TenantEditPage,
	},
	{
		path: 'sites',
		noun: (n: number): string => tp('entity.site', n),
		permission: 'view',
		icon: IconMapPin,
		list: SitesPage,
		add: SiteAddPage,
		detail: SiteDetailPage,
		edit: SiteEditPage,
	},
	{
		path: 'locations',
		noun: (n: number): string => tp('entity.location', n),
		permission: 'view',
		icon: IconLocation,
		list: LocationsPage,
		add: LocationAddPage,
		detail: LocationDetailPage,
		edit: LocationEditPage,
	},
	{
		path: 'racks',
		noun: (n: number): string => tp('entity.rack', n),
		permission: 'view',
		icon: IconBox,
		list: RacksPage,
		add: RackAddPage,
		detail: RackDetailPage,
		edit: RackEditPage,
	},
	{
		path: 'devices',
		noun: (n: number): string => tp('entity.device', n),
		permission: 'view',
		icon: IconServer,
		list: DevicesPage,
		add: DeviceAddPage,
		detail: DeviceDetailPage,
		edit: DeviceEditPage,
	},
	{
		path: 'device-roles',
		noun: (n: number): string => tp('entity.deviceRole', n),
		permission: 'view',
		icon: IconTag,
		list: DeviceRolesPage,
		add: DeviceRoleAddPage,
		detail: DeviceRoleDetailPage,
		edit: DeviceRoleEditPage,
	},
	{
		path: 'rack-types',
		aliases: ['templates'],
		noun: (n: number): string => tp('entity.rackType', n),
		permission: 'view',
		icon: IconTemplate,
		list: RackTypesPage,
		add: RackTypeAddPage,
	},
	{
		path: 'device-types',
		noun: (n: number): string => tp('entity.deviceType', n),
		permission: 'view',
		icon: IconCpu,
		list: DeviceTypesPage,
		add: DeviceTypeAddPage,
		import: DeviceTypeImportPage,
		detail: DeviceTypeDetailPage,
		edit: DeviceTypeEditPage,
	},
	{
		path: 'manufacturers',
		noun: (n: number): string => tp('entity.manufacturer', n),
		permission: 'view',
		icon: IconBuildingFactory,
		list: ManufacturersPage,
		add: ManufacturerAddPage,
		detail: ManufacturerDetailPage,
		edit: ManufacturerEditPage,
	},
	{
		path: 'tenant-groups',
		noun: (n: number): string => tp('entity.tenantGroup', n),
		permission: 'view',
		icon: IconBuildingSkyscraper,
		hideInNav: true,
		list: TenantGroupsPage,
		add: TenantGroupAddPage,
		detail: TenantGroupDetailPage,
		edit: TenantGroupEditPage,
	},
	{
		path: 'site-groups',
		noun: (n: number): string => tp('entity.siteGroup', n),
		permission: 'view',
		icon: IconFolder,
		hideInNav: true,
		list: SiteGroupsPage,
		add: SiteGroupAddPage,
		detail: SiteGroupDetailPage,
		edit: SiteGroupEditPage,
	},
	{
		path: 'shelves',
		noun: (n: number): string => tp('entity.shelf', n),
		permission: 'view',
		add: ShelfAddPage,
		edit: ShelfEditPage,
	},
	{
		path: 'topology',
		noun: (): string => t('entity.topology'),
		permission: 'view',
		icon: IconNetwork,
		hideAddInNav: true,
		list: TopologyPage,
	},
	{
		path: 'integrations',
		noun: (n: number): string => tp('entity.integration', n),
		icon: IconPlugConnected,
		// One integration per provider.
		permission: 'integrations.manage',
		hideAddInNav: true,
		list: IntegrationsPage,
		add: IntegrationAddPage,
		detail: IntegrationReportPage,
		edit: IntegrationEditPage,
	},
	{
		// Reached from the top-bar ticket button.
		path: 'tickets',
		noun: (n: number): string => tp('entity.ticket', n),
		permission: 'tickets.create',
		hideInNav: true,
		add: TicketAddPage,
	},
	{
		path: 'users',
		noun: (n: number): string => tp('entity.user', n),
		icon: IconLock,
		permission: 'users.manage',
		list: UsersPage,
		add: UserAddPage,
		edit: UserEditPage,
	},
	{
		path: 'roles',
		noun: (n: number): string => tp('entity.role', n),
		permission: 'users.manage',
		icon: IconShieldLock,
		list: RolesPage,
		add: RoleAddPage,
		edit: RoleEditPage,
	},
	{
		path: 'audit-log',
		noun: (n: number): string => tp('entity.auditLog', n),
		icon: IconHistory,
		permission: 'audit_log.view',
		hideAddInNav: true,
		list: AuditLogPage,
	},
	{
		path: 'changelog',
		noun: (n: number): string => tp('entity.changelog', n),
		icon: IconListDetails,
		permission: 'changelog.view',
		hideAddInNav: true,
		list: ChangelogPage,
		detail: ChangeDetailPage,
	},
]

/** Section a route belongs to; the bare root maps to the home section. */
export function routeSection(raw: string): Section | null {
	const first = routeSegments(raw)[0]
	if (first === undefined) {
		return SECTIONS[0] ?? null
	}
	return SECTIONS.find((s) => s.path === first || s.aliases?.includes(first)) ?? null
}

export type RouteMatch =
	| { kind: 'list' | 'add' | 'import'; section: Section; page: Component }
	| { kind: 'detail' | 'edit'; section: Section; page: Component<{ id: number }>; id: number }

/** True when the signed-in user may open the section. */
export function canOpenSection(section: Section): boolean {
	return section.permission === null || can(section.permission)
}

/**
 * True when the user may create entries in the section: inventory sections
 * need `edit`, admin sections their own permission.
 */
export function canAddInSection(section: Section): boolean {
	return section.permission === null || section.permission === 'view'
		? can('edit')
		: can(section.permission)
}

/**
 * Resolves a route path to its page, or null for not-found (or not
 * permitted; `checkPermission: false` resolves the shape only, e.g. for tab
 * labels).
 */
export function matchRoute(raw: string, checkPermission = true): RouteMatch | null {
	const section = routeSection(raw)
	if (!section || (checkPermission && !canOpenSection(section))) {
		return null
	}
	const [, second, third, ...rest] = routeSegments(raw)
	if (rest.length > 0) {
		return null
	}
	if (second === undefined) {
		return section.list ? { kind: 'list', section, page: section.list } : null
	}
	if (third === undefined && (second === 'add' || second === 'import')) {
		const page = section[second]
		return page ? { kind: second, section, page } : null
	}
	const id = parseId(second)
	if (id === null) {
		return null
	}
	if (third === undefined) {
		return section.detail ? { kind: 'detail', section, page: section.detail, id } : null
	}
	if (third === 'edit') {
		return section.edit ? { kind: 'edit', section, page: section.edit, id } : null
	}
	return null
}

export function isDetailRoute(raw: string): boolean {
	return matchRoute(raw, false)?.kind === 'detail'
}

/**
 * Short human label for a tab button, derived from the route and the name
 * its page reported once loaded.
 */
export function tabTitle(raw: string): string {
	const section = routeSection(raw)
	const [first, second, third] = routeSegments(raw)
	const name = pageMetaFor(raw)?.name
	if (!section) {
		return first ?? t('tab.page')
	}
	if (second === 'add') {
		return t('tab.add', { entity: section.noun(1) })
	}
	if (second === 'import') {
		return t('tab.import', { entities: section.noun(2) })
	}
	if (second !== undefined && third === 'edit') {
		return name !== undefined
			? t('tab.editNamed', { name })
			: t('tab.edit', { entity: section.noun(1), id: second })
	}
	if (second !== undefined) {
		return name ?? t('tab.detail', { entity: section.noun(1), id: second })
	}
	return section.noun(2)
}

/**
 * Breadcrumb trail for a routed page: the section list, the ancestors the
 * page reported, then the page itself (`Devices › DC1 › Rack 03 ›
 * sw-core-01`). Edit forms end in `› name › Edit` and reuse the detail
 * page's ancestors when they were seen. Lists get no trail.
 */
export function routeCrumbs(raw: string, match: RouteMatch): Crumb[] {
	const { section } = match
	if (match.kind === 'list') {
		return []
	}
	const meta = pageMetaFor(raw)
	const trail: Crumb[] = section.list
		? [{ label: section.noun(2), href: `/${section.path}` }]
		: []
	if (match.kind === 'edit') {
		const detailPath = `/${section.path}/${match.id}`
		const detail = pageMetaFor(detailPath)
		const name = meta?.name ?? detail?.name ?? tabTitle(detailPath)
		return [
			...trail,
			...(meta?.crumbs ?? detail?.crumbs ?? []),
			{ label: name, href: section.detail ? detailPath : undefined },
			{ label: t('common.edit') },
		]
	}
	return [...trail, ...(meta?.crumbs ?? []), { label: tabTitle(raw) }]
}
