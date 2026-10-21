/**
 * Main navigation: routed sections in labeled groups (NetBox-style, with
 * quick add/import buttons for writers) and the account menu at the bottom.
 * The whole sidebar collapses to an icon rail (persisted to localStorage).
 */
import {
	IconChevronsLeft,
	IconChevronsRight,
	IconDownload,
	IconKey,
	IconLogout,
	IconPlus,
	IconUserCircle,
} from '@tabler/icons-solidjs'
import { createSignal, For, type JSX, Show } from 'solid-js'
import type { SessionUser } from '../api/auth'
import { type MessageKey, t } from '../i18n'
import { useDismiss } from '../lib/dismiss'
import { goTo, path } from '../lib/router'
import { LanguageSwitcher } from './language_switcher'
import { PasswordDialog } from './password_dialog'
import { canAddInSection, canOpenSection, routeSection, SECTIONS, type Section } from './routes'

/** Hover shortcut next to a nav row; without `href` a disabled placeholder. */
function NavShortcut(props: {
	href?: string
	icon: typeof IconPlus
	label: string
	class?: string
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
					goTo(e, props.href)
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
	try {
		return window.localStorage.getItem(COLLAPSED_KEY) === '1'
	} catch {
		return false
	}
}

const [collapsed, setCollapsedSignal] = createSignal(loadCollapsed())

function setCollapsed(next: boolean): void {
	setCollapsedSignal(next)
	try {
		window.localStorage.setItem(COLLAPSED_KEY, next ? '1' : '0')
	} catch {
		// Storage unavailable (private mode): the toggle still works for the session.
	}
}

/**
 * One section row: icon and list link plus the add/import shortcuts
 * (the shortcuts are hidden while the sidebar is collapsed).
 */
function NavItem(props: { section: Section }): JSX.Element {
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
				aria-label={collapsed() ? label() : undefined}
				title={collapsed() ? label() : undefined}
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
			<Show when={!collapsed() && canAddInSection(props.section)}>
				<Show when={props.section.hideAddInNav !== true}>
					<NavShortcut
						href={addHref()}
						icon={IconPlus}
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
					/>
				</Show>
			</Show>
		</div>
	)
}

/** Account button with the language switcher, password change and logout in its dropdown. */
function UserMenu(props: { user: SessionUser | null; onLogout: () => void }): JSX.Element {
	const [open, setOpen] = createSignal(false)
	const [changingPassword, setChangingPassword] = createSignal(false)
	const name = (): string => props.user?.username ?? '…'

	useDismiss('.app-user-menu', () => setOpen(false))

	return (
		<div class="app-user-menu">
			<button
				type="button"
				class="app-user-button"
				aria-haspopup="menu"
				aria-expanded={open()}
				aria-label={t('app.accountNamed', { name: name() })}
				title={collapsed() ? name() : undefined}
				onClick={() => setOpen(!open())}
				onKeyDown={(e: KeyboardEvent): void => {
					if (e.key === 'Escape') {
						setOpen(false)
					}
				}}
			>
				<span aria-hidden="true" class="app-nav-icon app-user-icon">
					<IconUserCircle size={20} />
				</span>
				<span class="app-user-info">
					<span class="app-user-username">{name()}</span>
					<Show when={props.user}>
						{(user: () => SessionUser) => (
							<span class="app-user-role">{user().role.name}</span>
						)}
					</Show>
				</span>
			</button>
			<Show when={open()}>
				<div class="app-user-dropdown" role="menu" aria-label={t('app.account')}>
					<div class="app-user-language">
						<LanguageSwitcher />
					</div>
					<button
						type="button"
						role="menuitem"
						class="app-user-logout"
						onClick={() => {
							setOpen(false)
							setChangingPassword(true)
						}}
					>
						<span aria-hidden="true" class="app-nav-icon">
							<IconKey size={16} />
						</span>
						{t('account.changePassword')}
					</button>
					<button
						type="button"
						role="menuitem"
						class="app-user-logout"
						onClick={() => {
							setOpen(false)
							props.onLogout()
						}}
					>
						<span aria-hidden="true" class="app-nav-icon">
							<IconLogout size={16} />
						</span>
						{t('app.logout')}
					</button>
				</div>
			</Show>
			<Show when={changingPassword()}>
				<PasswordDialog on_close={() => setChangingPassword(false)} />
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
		paths: ['floorplans', 'employees', 'sites', 'locations'],
	},
	{ label: 'app.navGroup.devices', paths: ['racks', 'devices'] },
	{
		label: 'app.navGroup.catalog',
		paths: ['manufacturers', 'device-types', 'device-roles', 'rack-types', 'managed-bundles'],
	},
	{
		label: 'app.navGroup.administration',
		paths: ['integrations', 'users', 'roles', 'audit-log', 'changelog'],
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
function NavGroupSection(props: { group: NavGroup; sections: Section[] }): JSX.Element {
	return (
		<div class="app-nav-group">
			<div class="app-nav-label">{t(props.group.label)}</div>
			<For each={props.sections}>
				{(section: Section): JSX.Element => <NavItem section={section} />}
			</For>
		</div>
	)
}

export function Sidebar(props: { user: SessionUser | null; onLogout: () => void }): JSX.Element {
	return (
		<aside
			classList={{ 'app-sidebar': true, collapsed: collapsed() }}
			aria-label={t('app.mainNavigation')}
		>
			<nav class="app-nav">
				<Show when={SECTIONS.find((section) => section.path === 'dashboard')}>
					{(section: () => Section): JSX.Element => <NavItem section={section()} />}
				</Show>
				<For each={NAV_GROUPS}>
					{(group: NavGroup): JSX.Element => {
						const sections = (): Section[] => navSections(group.paths)
						return (
							<Show when={sections().length > 0}>
								<NavGroupSection group={group} sections={sections()} />
							</Show>
						)
					}}
				</For>
			</nav>
			<div class="app-sidebar-user">
				<UserMenu user={props.user} onLogout={props.onLogout} />
				<button
					type="button"
					class="app-sidebar-toggle"
					aria-expanded={!collapsed()}
					aria-label={collapsed() ? t('app.expandSidebar') : t('app.collapseSidebar')}
					title={collapsed() ? t('app.expandSidebar') : t('app.collapseSidebar')}
					onClick={() => setCollapsed(!collapsed())}
				>
					<span aria-hidden="true" class="app-nav-icon">
						<Show when={collapsed()} fallback={<IconChevronsLeft size={20} />}>
							<IconChevronsRight size={20} />
						</Show>
					</span>
				</button>
			</div>
		</aside>
	)
}
