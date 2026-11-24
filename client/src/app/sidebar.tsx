/**
 * Main navigation: routed sections in labeled groups (NetBox-style, with
 * quick add/import buttons for writers).
 * The whole sidebar collapses to an icon rail (persisted to localStorage);
 * its toggle sits in the top bar's corner cell above it.
 */
import {
	IconChevronsLeft,
	IconChevronsRight,
	IconDownload,
	IconPlus,
	IconX,
} from '@tabler/icons-solidjs'
import { createEffect, createSignal, For, type JSX, onCleanup, Show } from 'solid-js'
import { type MessageKey, t } from '../i18n'
import { goTo, path } from '../lib/router'
import { readStored, writeStored } from '../lib/storage'
import { canAddInSection, canOpenSection, routeSection, SECTIONS, type Section } from './routes'

/** Hover shortcut next to a nav row; without `href` a disabled placeholder. */
function NavShortcut(props: {
	href?: string
	icon: typeof IconPlus
	label: string
	class?: string
	onNavigate?: () => void
}): JSX.Element {
	return (
		<button
			type="button"
			class={props.class ? `app-nav-add ${props.class}` : 'app-nav-add'}
			disabled={props.href === undefined}
			aria-label={props.label}
			title={props.label}
			onClick={(e: MouseEvent): void => {
				e.stopPropagation()
				if (props.href) {
					goTo(e, props.href, { sameTab: true })
					props.onNavigate?.()
				}
			}}
		>
			<span aria-hidden="true" class="app-nav-add-icon">
				<props.icon size={14} />
			</span>
		</button>
	)
}

const COLLAPSED_KEY = 'conex:sidebar-collapsed'

function loadCollapsed(): boolean {
	return readStored(COLLAPSED_KEY) === '1'
}

const [collapsed, setCollapsedSignal] = createSignal(loadCollapsed())

function setCollapsed(next: boolean): void {
	setCollapsedSignal(next)
	writeStored(COLLAPSED_KEY, next ? '1' : '0')
}

/**
 * One section row: icon and list link plus the add/import shortcuts
 * (the shortcuts are hidden while the sidebar is collapsed).
 */
function NavItem(props: {
	section: Section
	collapsed: boolean
	onNavigate?: () => void
}): JSX.Element {
	const href = (): string => `/${props.section.path}`
	const active = (): boolean => {
		const current = routeSection(path())
		if (!current) {
			return false
		}
		if (current === props.section) {
			return true
		}
		// Group lists live as tabs of their parent page but keep their own
		// route: highlight the parent nav entry while on them.
		const parent = NAV_PARENT[current.path]
		return parent !== undefined && parent === props.section.path
	}
	const label = (): string => props.section.navLabel?.() ?? props.section.noun(2)
	const addHref = (): string | undefined => (props.section.add ? `${href()}/add` : undefined)
	return (
		<div classList={{ 'app-nav-item': true, active: active() }}>
			<a
				href={href()}
				class={active() ? 'active' : ''}
				aria-current={active() ? 'page' : undefined}
				aria-label={props.collapsed ? label() : undefined}
				title={props.collapsed ? label() : undefined}
				onClick={(e: MouseEvent): void => {
					goTo(e, href(), { sameTab: true })
					props.onNavigate?.()
				}}
			>
				<Show when={props.section.icon}>
					{(icon: () => NonNullable<Section['icon']>): JSX.Element => {
						const Icon = icon()
						return (
							<span aria-hidden="true" class="app-nav-icon">
								<Icon size={20} />
							</span>
						)
					}}
				</Show>
				<span class="app-nav-text">{label()}</span>
			</a>
			<Show when={!props.collapsed && canAddInSection(props.section)}>
				<Show when={props.section.hideAddInNav !== true}>
					<NavShortcut
						href={addHref()}
						icon={IconPlus}
						onNavigate={props.onNavigate}
						label={
							addHref()
								? t('app.navAdd', { label: label() })
								: t('app.navAddSoon', { label: label() })
						}
					/>
				</Show>
				<Show when={props.section.import}>
					<NavShortcut
						href={`${href()}/import`}
						icon={IconDownload}
						label={t('app.navImport', { label: label() })}
						class="app-nav-import"
						onNavigate={props.onNavigate}
					/>
				</Show>
			</Show>
		</div>
	)
}

interface NavGroup {
	label: MessageKey
	paths: readonly string[]
}

/** Sidebar groups in display order, listing section paths. Group lists are
 * tabs of their parent page, so only the parents appear here. */
const NAV_GROUPS: readonly NavGroup[] = [
	{
		label: 'app.navGroup.organization',
		paths: ['floorplans', 'floorplans-v2', 'employees', 'sites', 'locations'],
	},
	{ label: 'entity.device.other', paths: ['racks', 'devices'] },
	{
		label: 'app.navGroup.catalog',
		paths: ['manufacturers', 'device-types', 'device-roles', 'rack-types', 'managed-bundles'],
	},
	{ label: 'app.navGroup.customization', paths: ['saved-filters', 'saved-layouts'] },
	{
		label: 'app.navGroup.administration',
		paths: ['integrations', 'users', 'roles', 'global-settings', 'audit-log', 'changelog'],
	},
]

/** Routes without a nav entry mapped to the entry they highlight. */
const NAV_PARENT: Record<string, string> = {
	// The dashboard redirects to the home tenant page, so that page is "the dashboard".
	tenants: 'dashboard',
	'site-groups': 'sites',
	'service-levels': 'managed-bundles',
	priorities: 'managed-bundles',
	'devices/vm': 'devices',
}

/** Sections shown in a sidebar group: routed lists with an icon. */
function navSections(paths: readonly string[]): Section[] {
	return paths
		.map((p) => SECTIONS.find((section) => section.path === p))
		.filter(
			(section): section is Section =>
				section !== undefined &&
				section.icon !== undefined &&
				section.list !== undefined &&
				section.hideInNav !== true &&
				canOpenSection(section),
		)
}

/** Labeled group; collapsed, the label gives way to a divider. */
function NavGroupSection(props: {
	group: NavGroup
	sections: Section[]
	collapsed: boolean
	onNavigate?: () => void
}): JSX.Element {
	return (
		<div class="app-nav-group">
			<div class="app-nav-label">{t(props.group.label)}</div>
			<For each={props.sections}>
				{(section: Section): JSX.Element => (
					<NavItem
						section={section}
						collapsed={props.collapsed}
						onNavigate={props.onNavigate}
					/>
				)}
			</For>
		</div>
	)
}

interface SidebarProps {
	mobile?: boolean
	onClose?: () => void
}

export function Sidebar(props: SidebarProps): JSX.Element {
	const isCollapsed = (): boolean => !props.mobile && collapsed()
	return (
		<aside
			classList={{ 'app-sidebar': true, collapsed: isCollapsed() }}
			aria-label={t('app.mainNavigation')}
		>
			<Show when={props.mobile}>
				<div class="app-mobile-nav-header">
					<strong>{t('app.mainNavigation')}</strong>
					<button
						type="button"
						class="app-mobile-nav-toggle"
						aria-label={t('app.closeNavigation')}
						onClick={props.onClose}
					>
						<IconX size={22} aria-hidden="true" />
					</button>
				</div>
			</Show>
			<nav class="app-nav">
				<Show when={SECTIONS.find((section) => section.path === 'dashboard')}>
					{(section: () => Section): JSX.Element => (
						<NavItem
							section={section()}
							collapsed={isCollapsed()}
							onNavigate={props.onClose}
						/>
					)}
				</Show>
				<For each={NAV_GROUPS}>
					{(group: NavGroup): JSX.Element => {
						const sections = (): Section[] => navSections(group.paths)
						return (
							<Show when={sections().length > 0}>
								<NavGroupSection
									group={group}
									sections={sections()}
									collapsed={isCollapsed()}
									onNavigate={props.onClose}
								/>
							</Show>
						)
					}}
				</For>
			</nav>
		</aside>
	)
}

/**
 * Top-left corner cell of the top bar, as wide as the sidebar below it: the
 * brand (`children`) and the round collapse toggle on its right edge, in line
 * with the sidebar's edge; collapsed, only the toggle.
 */
export function SidebarCorner(props: { children: JSX.Element }): JSX.Element {
	return (
		<div classList={{ 'app-sidebar-corner': true, collapsed: collapsed() }}>
			<Show when={!collapsed()}>{props.children}</Show>
			<button
				type="button"
				class="app-sidebar-toggle"
				aria-expanded={!collapsed()}
				aria-label={collapsed() ? t('app.expandSidebar') : t('app.collapseSidebar')}
				title={collapsed() ? t('app.expandSidebar') : t('app.collapseSidebar')}
				onClick={() => setCollapsed(!collapsed())}
			>
				<span aria-hidden="true" class="app-nav-icon">
					<Show when={collapsed()} fallback={<IconChevronsLeft size={14} />}>
						<IconChevronsRight size={14} />
					</Show>
				</span>
			</button>
		</div>
	)
}

/** Native modal behavior provides focus containment, Escape and focus restoration. */
export function MobileSidebar(
	props: SidebarProps & { id: string; open: boolean; onClose: () => void },
): JSX.Element {
	let dialog: HTMLDialogElement | undefined

	createEffect(() => {
		if (props.open) {
			dialog?.showModal()
			const previousOverflow = document.body.style.overflow
			document.body.style.overflow = 'hidden'
			onCleanup(() => {
				document.body.style.overflow = previousOverflow
			})
		} else {
			dialog?.close()
		}
	})

	return (
		<dialog
			ref={dialog}
			id={props.id}
			class="app-mobile-nav-dialog"
			aria-label={t('app.mainNavigation')}
			onCancel={(e: Event): void => {
				e.preventDefault()
				props.onClose()
			}}
			onClose={props.onClose}
			onPointerDown={(e: PointerEvent): void => {
				if (e.target === e.currentTarget) {
					props.onClose()
				}
			}}
		>
			<Sidebar mobile onClose={props.onClose} />
		</dialog>
	)
}
