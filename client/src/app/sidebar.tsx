/**
 * Main navigation: one row per routed section (NetBox-style, with quick
 * add/import buttons for writers) and the account menu at the bottom.
 */
import { IconDownload, IconLogout, IconPlus } from '@tabler/icons-solidjs'
import { createSignal, For, type JSX, onCleanup, onMount, Show } from 'solid-js'
import { Dynamic } from 'solid-js/web'
import type { SessionUser } from '../api/auth'
import { t } from '../i18n'
import { roleLabel } from '../i18n/labels'
import { goTo, path } from '../lib/router'
import { canWrite } from '../lib/session'
import { LanguageSwitcher } from './language_switcher'
import { routeSection, SECTIONS, type Section } from './routes'

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

/** One section row: its list link plus the add/import shortcuts. */
function NavItem(props: { section: Section }): JSX.Element {
	const href = (): string => `/${props.section.path}`
	const active = (): boolean => routeSection(path()) === props.section
	const label = (): string => props.section.noun(2)
	const addHref = (): string | undefined =>
		props.section.add && props.section.hideAddInNav !== true ? `${href()}/add` : undefined
	return (
		<div class={active() ? 'app-nav-item active' : 'app-nav-item'}>
			<a
				href={href()}
				class={active() ? 'active' : ''}
				aria-current={active() ? 'page' : undefined}
			>
				<span aria-hidden="true" class="app-nav-icon">
					<Dynamic component={props.section.icon} size={16} />
				</span>
				{label()}
			</a>
			<Show when={canWrite()}>
				<NavShortcut
					href={addHref()}
					icon={IconPlus}
					label={
						addHref()
							? t('app.navAdd', { label: label() })
							: t('app.navAddSoon', { label: label() })
					}
				/>
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
							<span class="app-user-role">{roleLabel(user().role)}</span>
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

/** Sections shown in the sidebar: routed lists with an icon. */
function navSections(isAdmin: boolean): Section[] {
	return SECTIONS.filter(
		(section) =>
			section.icon !== undefined &&
			section.list !== undefined &&
			section.hideInNav !== true &&
			(section.adminOnly !== true || isAdmin),
	)
}

export function Sidebar(props: { user: SessionUser | null; onLogout: () => void }): JSX.Element {
	return (
		<aside class="app-sidebar" aria-label={t('app.mainNavigation')}>
			<nav class="app-nav">
				<For each={navSections(props.user?.role === 'admin')}>
					{(section: Section): JSX.Element => <NavItem section={section} />}
				</For>
			</nav>
			<div class="app-sidebar-user">
				<UserMenu user={props.user} onLogout={props.onLogout} />
			</div>
		</aside>
	)
}
