/**
 * Route table: one entry per top-level URL section. The route parser, the
 * page switch, the sidebar and the tab titles are all derived from it, so a
 * new entity only needs a row here.
 *
 * URL shape per section: `/<path>` (list), `/<path>/add`, `/<path>/import`,
 * `/<path>/:id` (detail) and `/<path>/:id/edit`. A kind without a page
 * resolves to not-found. A `path` may span several segments
 * (`devices/vm`); the longest matching section wins.
 */
import {
	IconBuildingFactory2,
	IconBuildingSkyscraper,
	IconCpu,
	IconDevices,
	IconFilter,
	IconFlag,
	IconFolder,
	IconHistory,
	IconLayoutDashboard,
	IconListDetails,
	IconLocation,
	IconLock,
	IconMap,
	IconMapPin,
	IconPackages,
	IconPlugConnected,
	IconShieldLock,
	IconStack3,
	IconStopwatch,
	IconTag,
	IconTemplate,
	IconUsers,
} from '@tabler/icons-solidjs'
import type { Permission } from 'shared/src/types'
import { type Component, lazy } from 'solid-js'
import { t, tp } from '../i18n'
import { type Crumb, pageMetaFor, parseId, routeSegments } from '../lib/router'
import { can } from '../lib/session'
import { DashboardPage } from '../pages/dashboard/view'

/**
 * Loads a page module on first render, so each page (and its heavy
 * dependencies, e.g. the floorplan editor or the markdown renderer) ships as
 * its own chunk. Kept module-level: the route match compares page identity.
 */
function lazyPage<P extends object>(load: () => Promise<Component<P>>): Component<P> {
	return lazy(async () => ({ default: await load() }))
}

const AuditLogPage = lazyPage(() => import('../pages/audit_log/list').then((m) => m.AuditLogPage))
const ChangeDetailPage = lazyPage(() =>
	import('../pages/changelog/detail').then((m) => m.ChangeDetailPage),
)
const ChangelogPage = lazyPage(() => import('../pages/changelog/list').then((m) => m.ChangelogPage))
const DeviceTypeDetailPage = lazyPage(() =>
	import('../pages/device_types/detail').then((m) => m.DeviceTypeDetailPage),
)
const DeviceTypeEditPage = lazyPage(() =>
	import('../pages/device_types/form').then((m) => m.DeviceTypeEditPage),
)
const DeviceTypeImportPage = lazyPage(() =>
	import('../pages/device_types/import').then((m) => m.DeviceTypeImportPage),
)
const DeviceTypesPage = lazyPage(() =>
	import('../pages/device_types/list').then((m) => m.DeviceTypesPage),
)
const DeviceRoleDetailPage = lazyPage(() =>
	import('../pages/device-roles/detail').then((m) => m.DeviceRoleDetailPage),
)
const DeviceRoleAddPage = lazyPage(() =>
	import('../pages/device-roles/form').then((m) => m.DeviceRoleAddPage),
)
const DeviceRoleEditPage = lazyPage(() =>
	import('../pages/device-roles/form').then((m) => m.DeviceRoleEditPage),
)
const DeviceRolesPage = lazyPage(() =>
	import('../pages/device-roles/list').then((m) => m.DeviceRolesPage),
)
const DeviceAddPage = lazyPage(() => import('../pages/devices/add').then((m) => m.DeviceAddPage))
const DeviceDetailPage = lazyPage(() =>
	import('../pages/devices/detail').then((m) => m.DeviceDetailPage),
)
const DeviceEditPage = lazyPage(() => import('../pages/devices/edit').then((m) => m.DeviceEditPage))
const DevicesPage = lazyPage(() => import('../pages/devices/list').then((m) => m.DevicesPage))
const VirtualMachineDetailPage = lazyPage(() =>
	import('../pages/devices/vm_detail').then((m) => m.VirtualMachineDetailPage),
)
const VirtualMachineAddPage = lazyPage(() =>
	import('../pages/devices/vm_form').then((m) => m.VirtualMachineAddPage),
)
const VirtualMachineEditPage = lazyPage(() =>
	import('../pages/devices/vm_form').then((m) => m.VirtualMachineEditPage),
)
const EmployeeDetailPage = lazyPage(() =>
	import('../pages/employees/detail').then((m) => m.EmployeeDetailPage),
)
const EmployeeAddPage = lazyPage(() =>
	import('../pages/employees/form').then((m) => m.EmployeeAddPage),
)
const EmployeeEditPage = lazyPage(() =>
	import('../pages/employees/form').then((m) => m.EmployeeEditPage),
)
const EmployeesPage = lazyPage(() => import('../pages/employees/list').then((m) => m.EmployeesPage))
const FloorplanDetailPage = lazyPage(() =>
	import('../pages/floorplans/detail').then((m) => m.FloorplanDetailPage),
)
const FloorplansPage = lazyPage(() =>
	import('../pages/floorplans/list').then((m) => m.FloorplansPage),
)
const IntegrationAddPage = lazyPage(() =>
	import('../pages/integrations/add').then((m) => m.IntegrationAddPage),
)
const CalendarSyncTechniciansPage = lazyPage(() =>
	import('../pages/integrations/calendar_sync').then((m) => m.CalendarSyncTechniciansPage),
)
const IntegrationEditPage = lazyPage(() =>
	import('../pages/integrations/edit').then((m) => m.IntegrationEditPage),
)
const IntegrationsPage = lazyPage(() =>
	import('../pages/integrations/list').then((m) => m.IntegrationsPage),
)
const IntegrationReportPage = lazyPage(() =>
	import('../pages/integrations/report').then((m) => m.IntegrationReportPage),
)
const LocationAddPage = lazyPage(() =>
	import('../pages/locations/add').then((m) => m.LocationAddPage),
)
const LocationDetailPage = lazyPage(() =>
	import('../pages/locations/detail').then((m) => m.LocationDetailPage),
)
const LocationEditPage = lazyPage(() =>
	import('../pages/locations/edit').then((m) => m.LocationEditPage),
)
const LocationsPage = lazyPage(() => import('../pages/locations/list').then((m) => m.LocationsPage))
const ManagedBundleDetailPage = lazyPage(() =>
	import('../pages/managed-bundles/detail').then((m) => m.ManagedBundleDetailPage),
)
const ManagedBundleAddPage = lazyPage(() =>
	import('../pages/managed-bundles/form').then((m) => m.ManagedBundleAddPage),
)
const ManagedBundleEditPage = lazyPage(() =>
	import('../pages/managed-bundles/form').then((m) => m.ManagedBundleEditPage),
)
const ManagedBundlesPage = lazyPage(() =>
	import('../pages/managed-bundles/list').then((m) => m.ManagedBundlesPage),
)
const ManufacturerDetailPage = lazyPage(() =>
	import('../pages/manufacturers/detail').then((m) => m.ManufacturerDetailPage),
)
const ManufacturerAddPage = lazyPage(() =>
	import('../pages/manufacturers/form').then((m) => m.ManufacturerAddPage),
)
const ManufacturerEditPage = lazyPage(() =>
	import('../pages/manufacturers/form').then((m) => m.ManufacturerEditPage),
)
const ManufacturersPage = lazyPage(() =>
	import('../pages/manufacturers/list').then((m) => m.ManufacturersPage),
)
const PriorityDetailPage = lazyPage(() =>
	import('../pages/priorities/detail').then((m) => m.PriorityDetailPage),
)
const PriorityAddPage = lazyPage(() =>
	import('../pages/priorities/form').then((m) => m.PriorityAddPage),
)
const PriorityEditPage = lazyPage(() =>
	import('../pages/priorities/form').then((m) => m.PriorityEditPage),
)
const PrioritiesPage = lazyPage(() =>
	import('../pages/priorities/list').then((m) => m.PrioritiesPage),
)
const RackTypeDetailPage = lazyPage(() =>
	import('../pages/rack_types/detail').then((m) => m.RackTypeDetailPage),
)
const RackTypeAddPage = lazyPage(() =>
	import('../pages/rack_types/form').then((m) => m.RackTypeAddPage),
)
const RackTypeEditPage = lazyPage(() =>
	import('../pages/rack_types/form').then((m) => m.RackTypeEditPage),
)
const RackTypesPage = lazyPage(() =>
	import('../pages/rack_types/list').then((m) => m.RackTypesPage),
)
const RackAddPage = lazyPage(() => import('../pages/racks/add').then((m) => m.RackAddPage))
const RackDetailPage = lazyPage(() => import('../pages/racks/detail').then((m) => m.RackDetailPage))
const RackEditPage = lazyPage(() => import('../pages/racks/edit').then((m) => m.RackEditPage))
const RacksPage = lazyPage(() => import('../pages/racks/list').then((m) => m.RacksPage))
const RoleAddPage = lazyPage(() => import('../pages/roles/form').then((m) => m.RoleAddPage))
const RoleEditPage = lazyPage(() => import('../pages/roles/form').then((m) => m.RoleEditPage))
const RolesPage = lazyPage(() => import('../pages/roles/list').then((m) => m.RolesPage))
const SavedFiltersPage = lazyPage(() =>
	import('../pages/saved_filters/list').then((m) => m.SavedFiltersPage),
)
const ServiceLevelDetailPage = lazyPage(() =>
	import('../pages/service-levels/detail').then((m) => m.ServiceLevelDetailPage),
)
const ServiceLevelAddPage = lazyPage(() =>
	import('../pages/service-levels/form').then((m) => m.ServiceLevelAddPage),
)
const ServiceLevelEditPage = lazyPage(() =>
	import('../pages/service-levels/form').then((m) => m.ServiceLevelEditPage),
)
const ServiceLevelsPage = lazyPage(() =>
	import('../pages/service-levels/list').then((m) => m.ServiceLevelsPage),
)
const ShelfAddPage = lazyPage(() => import('../pages/shelves/form').then((m) => m.ShelfAddPage))
const ShelfEditPage = lazyPage(() => import('../pages/shelves/form').then((m) => m.ShelfEditPage))
const SiteGroupDetailPage = lazyPage(() =>
	import('../pages/site_groups/detail').then((m) => m.SiteGroupDetailPage),
)
const SiteGroupAddPage = lazyPage(() =>
	import('../pages/site_groups/form').then((m) => m.SiteGroupAddPage),
)
const SiteGroupEditPage = lazyPage(() =>
	import('../pages/site_groups/form').then((m) => m.SiteGroupEditPage),
)
const SiteGroupsPage = lazyPage(() =>
	import('../pages/site_groups/list').then((m) => m.SiteGroupsPage),
)
const SiteDetailPage = lazyPage(() => import('../pages/sites/detail').then((m) => m.SiteDetailPage))
const SiteAddPage = lazyPage(() => import('../pages/sites/form').then((m) => m.SiteAddPage))
const SiteEditPage = lazyPage(() => import('../pages/sites/form').then((m) => m.SiteEditPage))
const SitesPage = lazyPage(() => import('../pages/sites/list').then((m) => m.SitesPage))
const TenantGroupDetailPage = lazyPage(() =>
	import('../pages/tenant_groups/detail').then((m) => m.TenantGroupDetailPage),
)
const TenantGroupAddPage = lazyPage(() =>
	import('../pages/tenant_groups/form').then((m) => m.TenantGroupAddPage),
)
const TenantGroupEditPage = lazyPage(() =>
	import('../pages/tenant_groups/form').then((m) => m.TenantGroupEditPage),
)
const TenantGroupsPage = lazyPage(() =>
	import('../pages/tenant_groups/list').then((m) => m.TenantGroupsPage),
)
const TenantDetailPage = lazyPage(() =>
	import('../pages/tenants/detail').then((m) => m.TenantDetailPage),
)
const TenantAddPage = lazyPage(() => import('../pages/tenants/form').then((m) => m.TenantAddPage))
const TenantEditPage = lazyPage(() => import('../pages/tenants/form').then((m) => m.TenantEditPage))
const TenantsPage = lazyPage(() => import('../pages/tenants/list').then((m) => m.TenantsPage))
const TicketAddPage = lazyPage(() => import('../pages/tickets/add').then((m) => m.TicketAddPage))
const UserAddPage = lazyPage(() => import('../pages/users/add').then((m) => m.UserAddPage))
const UserEditPage = lazyPage(() => import('../pages/users/edit').then((m) => m.UserEditPage))
const UsersPage = lazyPage(() => import('../pages/users/list').then((m) => m.UsersPage))

export interface Section {
	/** Leading URL segment(s) (`/devices/…`, `/devices/vm/…`). */
	path: string
	/** Section whose list heads the breadcrumbs of a section without its own list, or of a sub-page. */
	parent?: string
	/** Localized entity name for tab titles and the sidebar. */
	noun: (count: number) => string
	/** Sidebar label overriding the plural noun (e.g. a page that heads several tabbed lists). */
	navLabel?: () => string
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
		permission: null,
		icon: IconLayoutDashboard,
		// Linked at the top of the sidebar, outside the groups.
		hideInNav: true,
		hideAddInNav: true,
		list: DashboardPage,
	},
	{
		path: 'tenants',
		noun: (n: number): string => tp('entity.tenant', n),
		permission: 'view',
		icon: IconUsers,
		// Reached via the list button next to the top-bar tenant context.
		hideInNav: true,
		list: TenantsPage,
		add: TenantAddPage,
		detail: TenantDetailPage,
		edit: TenantEditPage,
	},
	{
		// Plans are marked as such on their site or location (its images).
		path: 'floorplans',
		noun: (n: number): string => tp('entity.floorplan', n),
		permission: 'view',
		icon: IconMap,
		hideAddInNav: true,
		list: FloorplansPage,
		detail: FloorplanDetailPage,
	},
	{
		path: 'employees',
		noun: (n: number): string => tp('entity.employee', n),
		permission: 'view',
		icon: IconUsers,
		list: EmployeesPage,
		add: EmployeeAddPage,
		detail: EmployeeDetailPage,
		edit: EmployeeEditPage,
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
		icon: IconStack3,
		list: RacksPage,
		add: RackAddPage,
		detail: RackDetailPage,
		edit: RackEditPage,
	},
	{
		path: 'devices',
		noun: (n: number): string => tp('entity.device', n),
		permission: 'view',
		icon: IconDevices,
		list: DevicesPage,
		add: DeviceAddPage,
		detail: DeviceDetailPage,
		edit: DeviceEditPage,
	},
	{
		// Virtual machines are listed in the devices table.
		path: 'devices/vm',
		parent: 'devices',
		noun: (n: number): string => tp('entity.virtualMachine', n),
		permission: 'view',
		hideInNav: true,
		add: VirtualMachineAddPage,
		detail: VirtualMachineDetailPage,
		edit: VirtualMachineEditPage,
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
		noun: (n: number): string => tp('entity.rackType', n),
		permission: 'view',
		icon: IconTemplate,
		list: RackTypesPage,
		add: RackTypeAddPage,
		detail: RackTypeDetailPage,
		edit: RackTypeEditPage,
	},
	{
		path: 'device-types',
		noun: (n: number): string => tp('entity.deviceType', n),
		permission: 'view',
		icon: IconCpu,
		list: DeviceTypesPage,
		// Created via the import page only; its nav shortcut replaces "+ Add".
		hideAddInNav: true,
		import: DeviceTypeImportPage,
		detail: DeviceTypeDetailPage,
		edit: DeviceTypeEditPage,
	},
	{
		path: 'manufacturers',
		noun: (n: number): string => tp('entity.manufacturer', n),
		permission: 'view',
		icon: IconBuildingFactory2,
		list: ManufacturersPage,
		add: ManufacturerAddPage,
		detail: ManufacturerDetailPage,
		edit: ManufacturerEditPage,
	},
	{
		path: 'managed-bundles',
		noun: (n: number): string => tp('entity.managedBundle', n),
		permission: 'view',
		navLabel: (): string => t('app.nav.managedService'),
		icon: IconPackages,
		list: ManagedBundlesPage,
		add: ManagedBundleAddPage,
		detail: ManagedBundleDetailPage,
		edit: ManagedBundleEditPage,
	},
	{
		path: 'service-levels',
		noun: (n: number): string => tp('entity.serviceLevel', n),
		permission: 'view',
		icon: IconStopwatch,
		hideInNav: true,
		list: ServiceLevelsPage,
		add: ServiceLevelAddPage,
		detail: ServiceLevelDetailPage,
		edit: ServiceLevelEditPage,
	},
	{
		path: 'priorities',
		noun: (n: number): string => tp('entity.priority', n),
		permission: 'view',
		icon: IconFlag,
		hideInNav: true,
		list: PrioritiesPage,
		add: PriorityAddPage,
		detail: PriorityDetailPage,
		edit: PriorityEditPage,
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
		// Technician mapping of the calendar sync, linked from its card.
		path: 'integrations/calendar-sync',
		parent: 'integrations',
		noun: (): string => t('calendarSync.techniciansTitle'),
		permission: 'integrations.manage',
		hideInNav: true,
		list: CalendarSyncTechniciansPage,
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
		noun: (): string => t('entity.changelog'),
		icon: IconListDetails,
		permission: 'changelog.view',
		hideAddInNav: true,
		list: ChangelogPage,
		detail: ChangeDetailPage,
	},
	{
		// Filters are saved from each list's "Saved filters" tab.
		path: 'saved-filters',
		noun: (n: number): string => tp('entity.savedFilter', n),
		icon: IconFilter,
		permission: null,
		hideAddInNav: true,
		list: SavedFiltersPage,
	},
]

/** Section of a route plus the segments after its path; the bare root maps to the home section. */
function sectionMatch(raw: string): { section: Section; rest: string[] } | null {
	const segments = routeSegments(raw)
	if (segments.length === 0) {
		const home = SECTIONS[0]
		return home ? { section: home, rest: [] } : null
	}
	let best: { section: Section; rest: string[] } | null = null
	for (const section of SECTIONS) {
		const parts = section.path.split('/')
		const matches = parts.every((part, i) => segments[i] === part)
		if (matches && (best === null || parts.length > segments.length - best.rest.length)) {
			best = { section, rest: segments.slice(parts.length) }
		}
	}
	return best
}

/** Section a route belongs to; the bare root maps to the home section. */
export function routeSection(raw: string): Section | null {
	return sectionMatch(raw)?.section ?? null
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
	const matched = sectionMatch(raw)
	if (!matched || (checkPermission && !canOpenSection(matched.section))) {
		return null
	}
	const { section } = matched
	const [second, third, ...rest] = matched.rest
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
	const matched = sectionMatch(raw)
	const name = pageMetaFor(raw)?.name
	if (!matched) {
		return routeSegments(raw)[0] ?? t('tab.page')
	}
	const { section } = matched
	const [second, third] = matched.rest
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
		// A sub-page listed under another section's list (calendar sync technicians).
		const parent = SECTIONS.find((s) => s.path === section.parent)
		return parent?.list
			? [{ label: parent.noun(2), href: `/${parent.path}` }, { label: tabTitle(raw) }]
			: []
	}
	const meta = pageMetaFor(raw)
	const head = section.list ? section : SECTIONS.find((s) => s.path === section.parent)
	const trail: Crumb[] = head?.list ? [{ label: head.noun(2), href: `/${head.path}` }] : []
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
