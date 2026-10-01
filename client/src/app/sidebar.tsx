/**
 * Main navigation: routed sections in labeled groups (NetBox-style, with
 * quick add/import buttons for writers) and the account menu at the bottom.
 */
import {
	IconBook,
	IconBuilding,
	IconChevronDown,
	IconDownload,
	IconLogout,
	IconPlus,
	IconServer,
	IconSettings,
} from '@tabler/icons-solidjs'
import type { Component } from 'solid-js'
import { createEffect, createSignal, For, type JSX, onCleanup, onMount, Show } from 'solid-js'
import type { SessionUser } from '../api/auth'
import { type MessageKey, t } from '../i18n'
import { goTo, path } from '../lib/router'
import { LanguageSwitcher } from './language_switcher'
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

/**
 * One section row: its list link plus the add/import shortcuts. Top-level
 * rows (outside any group) show the section icon in the link.
 */
function NavItem(props: { section: Section; topLevel?: boolean }): JSX.Element {
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
	const label = (): string => props.section.noun(2)
	const addHref = (): string | undefined => (props.section.add ? `${href()}/add` : undefined)
	return (
		<div
			class={active() ? 'app-nav-item active' : 'app-nav-item'}
			classList={{ 'app-nav-top': props.topLevel === true }}
		>
			<a
				href={href()}
				class={active() ? 'active' : ''}
				aria-current={active() ? 'page' : undefined}
			>
				<Show when={props.topLevel === true ? props.section.icon : undefined}>
					{(icon: () => Component<{ size?: number }>): JSX.Element => {
						const Icon = icon()
						return (
							<span aria-hidden="true" class="app-nav-icon">
								<Icon size={16} />
							</span>
						)
					}}
				</Show>
				{label()}
			</a>
			<Show when={canAddInSection(props.section)}>
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

/** Account button with the language switcher and logout in its dropdown. */
function UserMenu(props: { user: SessionUser | null; onLogout: () => void }): JSX.Element {
	const [open, setOpen] = createSignal(false)
	const name = (): string => props.user?.username ?? '…'

	onMount(() => {
		const onDocClick = (e: MouseEvent): void => {
			if (e.target instanceof Element && e.target.closest('.app-user-menu') === null) {
				setOpen(false)
			}
		}
		document.addEventListener('click', onDocClick)
		onCleanup(() => document.removeEventListener('click', onDocClick))
	})

	return (
		<div class="app-user-menu">
			<button
				type="button"
				class="app-user-button"
				aria-haspopup="menu"
				aria-expanded={open()}
				aria-label={t('app.accountNamed', { name: name() })}
				onClick={() => setOpen(!open())}
				onKeyDown={(e: KeyboardEvent): void => {
					if (e.key === 'Escape') {
						setOpen(false)
					}
				}}
			>
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
		</div>
	)
}

interface NavGroup {
	label: MessageKey
	icon: Component<{ size?: number }>
	paths: readonly string[]
}

/** Sections shown above the groups as standalone rows. */
const NAV_TOP: readonly string[] = ['dashboard']

/** Sidebar groups in display order, listing section paths. Group lists are
 * tabs of their parent page, so only the parents appear here. */
const NAV_GROUPS: readonly NavGroup[] = [
	{
		label: 'app.navGroup.organization',
		icon: IconBuilding,
		paths: ['tenants', 'sites', 'locations'],
	},
	{ label: 'app.navGroup.devices', icon: IconServer, paths: ['racks', 'devices', 'topology'] },
	{
		label: 'app.navGroup.catalog',
		icon: IconBook,
		paths: ['manufacturers', 'device-types', 'device-roles', 'rack-types'],
	},
	{
		label: 'app.navGroup.administration',
		icon: IconSettings,
		paths: ['integrations', 'users', 'roles', 'audit-log'],
	},
]

/** Routes without a nav entry mapped to the entry they highlight. */
const NAV_PARENT: Record<string, string> = {
	'tenant-groups': 'tenants',
	'site-groups': 'sites',
	changelog: 'dashboard',
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

/**
 * Collapsible group (NetBox-style): starts open when it holds the current
 * page and opens itself when navigation lands in it; otherwise the header
 * toggles it.
 */
function NavGroupSection(props: { group: NavGroup; sections: Section[] }): JSX.Element {
	const holdsActive = (): boolean => {
		const current = routeSection(path())
		if (current === null) {
			return false
		}
		if (props.sections.includes(current)) {
			return true
		}
		const parent = NAV_PARENT[current.path]
		return parent !== undefined && props.sections.some((section) => section.path === parent)
	}
	const [open, setOpen] = createSignal(holdsActive())
	createEffect(() => {
		if (holdsActive()) {
			setOpen(true)
		}
	})
	return (
		<div class={open() ? 'app-nav-group open' : 'app-nav-group'}>
			<button
				type="button"
				class="app-nav-label"
				aria-expanded={open()}
				onClick={() => setOpen(!open())}
			>
				<span aria-hidden="true" class="app-nav-icon">
					<props.group.icon size={16} />
				</span>
				<span class="app-nav-label-text">{t(props.group.label)}</span>
				<span aria-hidden="true" class="app-nav-chevron">
					<IconChevronDown size={14} />
				</span>
			</button>
			<Show when={open()}>
				<For each={props.sections}>
					{(section: Section): JSX.Element => <NavItem section={section} />}
				</For>
			</Show>
		</div>
	)
}

export function Sidebar(props: { user: SessionUser | null; onLogout: () => void }): JSX.Element {
	return (
		<aside class="app-sidebar" aria-label={t('app.mainNavigation')}>
			<nav class="app-nav">
				<For each={navSections(NAV_TOP)}>
					{(section: Section): JSX.Element => <NavItem section={section} topLevel />}
				</For>
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
			</div>
		</aside>
	)
}
