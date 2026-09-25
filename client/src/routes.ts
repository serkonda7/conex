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
	IconCpu,
	IconFolder,
	IconLink,
	IconLocation,
	IconLock,
	IconMapPin,
	IconNetwork,
	IconPlug,
	IconServer,
	IconTemplate,
	IconUsers,
} from '@tabler/icons-solidjs'
import type { Component } from 'solid-js'
import { t, tp } from './i18n'
import { ConnectionsPage } from './pages/connections'
import { DeviceAddPage } from './pages/device_add'
import { DeviceDetailPage } from './pages/device_detail'
import { DeviceEditPage } from './pages/device_edit'
import { DeviceTypeAddPage } from './pages/device_type_add'
import { DeviceTypeDetailPage } from './pages/device_type_detail'
import { DeviceTypeEditPage } from './pages/device_type_edit'
import { DeviceTypeImportPage } from './pages/device_type_import'
import { DeviceTypesPage } from './pages/device_types'
import { DevicesPage } from './pages/devices'
import { InterfacesPage } from './pages/interfaces'
import { LocationAddPage } from './pages/location_add'
import { LocationDetailPage } from './pages/location_detail'
import { LocationEditPage } from './pages/location_edit'
import { LocationsPage } from './pages/locations'
import { ManufacturerAddPage } from './pages/manufacturer_add'
import { ManufacturerDetailPage } from './pages/manufacturer_detail'
import { ManufacturerEditPage } from './pages/manufacturer_edit'
import { ManufacturersPage } from './pages/manufacturers'
import { RackAddPage } from './pages/rack_add'
import { RackDetailPage } from './pages/rack_detail'
import { RackEditPage } from './pages/rack_edit'
import { RackTypeAddPage } from './pages/rack_type_add'
import { RackTypesPage } from './pages/rack_types'
import { RacksPage } from './pages/racks'
import { ShelfAddPage } from './pages/shelf_add'
import { ShelfEditPage } from './pages/shelf_edit'
import { SiteAddPage } from './pages/site_add'
import { SiteDetailPage } from './pages/site_detail'
import { SiteEditPage } from './pages/site_edit'
import { SiteGroupAddPage } from './pages/site_group_add'
import { SiteGroupDetailPage } from './pages/site_group_detail'
import { SiteGroupEditPage } from './pages/site_group_edit'
import { SiteGroupsPage } from './pages/site_groups'
import { SitesPage } from './pages/sites'
import { TenantAddPage } from './pages/tenant_add'
import { TenantDetailPage } from './pages/tenant_detail'
import { TenantEditPage } from './pages/tenant_edit'
import { TenantsPage } from './pages/tenants'
import { TopologyPage } from './pages/topology'
import { UserAddPage } from './pages/user_add'
import { UserEditPage } from './pages/user_edit'
import { UsersPage } from './pages/users'
import { type Crumb, pageMetaFor, parseId, routeSegments } from './router'

export interface Section {
	/** First URL segment (`/devices/…`). */
	path: string
	/** Legacy segments resolving to the same section. */
	aliases?: readonly string[]
	/** Localized entity name for tab titles and the sidebar. */
	noun: (count: number) => string
	/** Sidebar icon; sections without one (or without a list) stay hidden. */
	icon?: Component<{ size?: number }>
	adminOnly?: boolean
	list?: Component
	add?: Component
	import?: Component
	detail?: Component<{ id: number }>
	edit?: Component<{ id: number }>
}

/** Every routed section in sidebar order; the first one is the home page. */
export const SECTIONS: readonly Section[] = [
	{
		path: 'tenants',
		noun: (n: number): string => tp('entity.tenant', n),
		icon: IconUsers,
		list: TenantsPage,
		add: TenantAddPage,
		detail: TenantDetailPage,
		edit: TenantEditPage,
	},
	{
		path: 'site-groups',
		noun: (n: number): string => tp('entity.siteGroup', n),
		icon: IconFolder,
		list: SiteGroupsPage,
		add: SiteGroupAddPage,
		detail: SiteGroupDetailPage,
		edit: SiteGroupEditPage,
	},
	{
		path: 'sites',
		noun: (n: number): string => tp('entity.site', n),
		icon: IconMapPin,
		list: SitesPage,
		add: SiteAddPage,
		detail: SiteDetailPage,
		edit: SiteEditPage,
	},
	{
		path: 'locations',
		noun: (n: number): string => tp('entity.location', n),
		icon: IconLocation,
		list: LocationsPage,
		add: LocationAddPage,
		detail: LocationDetailPage,
		edit: LocationEditPage,
	},
	{
		path: 'racks',
		noun: (n: number): string => tp('entity.rack', n),
		icon: IconBox,
		list: RacksPage,
		add: RackAddPage,
		detail: RackDetailPage,
		edit: RackEditPage,
	},
	{
		path: 'shelves',
		noun: (n: number): string => tp('entity.shelf', n),
		add: ShelfAddPage,
		edit: ShelfEditPage,
	},
	{
		path: 'rack-types',
		aliases: ['templates'],
		noun: (n: number): string => tp('entity.rackType', n),
		icon: IconTemplate,
		list: RackTypesPage,
		add: RackTypeAddPage,
	},
	{
		path: 'device-types',
		noun: (n: number): string => tp('entity.deviceType', n),
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
		icon: IconBuildingFactory,
		list: ManufacturersPage,
		add: ManufacturerAddPage,
		detail: ManufacturerDetailPage,
		edit: ManufacturerEditPage,
	},
	{
		path: 'devices',
		noun: (n: number): string => tp('entity.device', n),
		icon: IconServer,
		list: DevicesPage,
		add: DeviceAddPage,
		detail: DeviceDetailPage,
		edit: DeviceEditPage,
	},
	{
		path: 'interfaces',
		noun: (n: number): string => tp('entity.interface', n),
		icon: IconPlug,
		list: InterfacesPage,
	},
	{
		path: 'connections',
		aliases: ['cables'],
		noun: (n: number): string => tp('entity.connection', n),
		icon: IconLink,
		list: ConnectionsPage,
	},
	{
		path: 'topology',
		noun: (): string => t('entity.topology'),
		icon: IconNetwork,
		list: TopologyPage,
	},
	{
		path: 'users',
		noun: (n: number): string => tp('entity.user', n),
		icon: IconLock,
		adminOnly: true,
		list: UsersPage,
		add: UserAddPage,
		edit: UserEditPage,
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

/** Resolves a route path to its page, or null for not-found. */
export function matchRoute(raw: string, isAdmin: boolean): RouteMatch | null {
	const section = routeSection(raw)
	if (!section || (section.adminOnly === true && !isAdmin)) {
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
	return matchRoute(raw, true)?.kind === 'detail'
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
