/**
 * App shell: the session gate (first-run setup, login) and, once signed in,
 * the top bar, sidebar and the one page shown for the current URL.
 */
import { IconMenu2 } from '@tabler/icons-solidjs'
import {
	createEffect,
	createSignal,
	createUniqueId,
	type JSX,
	Match,
	onCleanup,
	onMount,
	Show,
	Switch,
} from 'solid-js'
import { fetchMe, fetchSetupStatus, logout, type SessionUser } from '../api/auth'
import { set_unauthorized_handler } from '../api/client'
import { Loading } from '../components/feedback'
import { type Locale, locale, t } from '../i18n'
import { loadUserPreferences } from '../lib/preferences'
import { queryClient } from '../lib/query'
import { goTo, navigate, path } from '../lib/router'
import { setSessionAccess, setSessionUserHandler } from '../lib/session'
import { homePath, refreshTenantContext, setTenantContextScoped } from '../lib/tenant_context'
import { formatTime } from '../lib/time'
import { CreateTicketButton } from '../pages/tickets/button'
import { APP_TITLE, LoginPage, SetupPage } from './auth_page'
import { CommandPalette, CommandPaletteButton } from './command_palette'
import { RouteContent } from './route_content'
import { pageTitle } from './routes'
import { MobileSidebar, Sidebar, SidebarCorner } from './sidebar'
import { TenantContextSelector } from './tenant_context_selector'
import { LogoutButton, UserMenu } from './user_menu'
import { ViewAsBanner } from './view_as_banner'

/**
 * Routes in-app anchors that have no click handler of their own through
 * `goTo`. Modified and middle clicks are left to the browser, which opens
 * its own tab; anchors whose handler already called `goTo` are skipped.
 */
function onLinkClick(e: MouseEvent): void {
	if (e.defaultPrevented || e.button !== 0 || !(e.target instanceof Element)) {
		return
	}
	if (e.ctrlKey || e.metaKey || e.shiftKey) {
		return
	}
	const anchor = e.target.closest('a[href]')
	if (
		!(anchor instanceof HTMLAnchorElement) ||
		anchor.target !== '' ||
		anchor.hasAttribute('download')
	) {
		return
	}
	const href = anchor.getAttribute('href') ?? ''
	if (href.startsWith('/') && !href.startsWith('//')) {
		goTo(e, href)
	}
}

/** Signed-in layout; `user` drives the permission-dependent parts. */
function Workspace(props: { user: SessionUser; onLogout: () => void }): JSX.Element {
	const navigationId = createUniqueId()
	const mobileQuery = window.matchMedia('(max-width: 48rem)')
	const [mobile, setMobile] = createSignal(mobileQuery.matches)
	const [navigationOpen, setNavigationOpen] = createSignal(false)
	const [paletteOpen, setPaletteOpen] = createSignal(false)
	const closeNavigation = (): void => {
		setNavigationOpen(false)
	}

	onMount(() => {
		const onResize = (): void => {
			setMobile(mobileQuery.matches)
			closeNavigation()
		}
		mobileQuery.addEventListener('change', onResize)
		onCleanup(() => mobileQuery.removeEventListener('change', onResize))
	})

	// Users limited to tenants; with a single one the context selector is fixed.
	const isScoped = (): boolean => props.user.tenant_ids !== null
	const singleTenant = (): number | null => {
		const ids = props.user.tenant_ids
		return ids?.length === 1 ? (ids[0] ?? null) : null
	}
	const fixedContext = (): boolean => isScoped() && (props.user.tenant_ids?.length ?? 0) <= 1
	// Tenant create is limited to global users with `edit` (server-enforced).
	const canAddTenants = (): boolean => props.user.permissions.includes('edit') && !isScoped()

	createEffect(() => {
		document.title = `${pageTitle(path())} · ${APP_TITLE}`
	})
	createEffect(() => {
		loadUserPreferences(props.user.username)
		setSessionAccess({
			permissions: props.user.permissions,
			tenantIds: props.user.tenant_ids,
			employeeId: props.user.employee_id,
		})
		setTenantContextScoped(fixedContext())
		if (props.user.permissions.includes('view')) {
			void refreshTenantContext()
		}
	})
	onCleanup(() => {
		loadUserPreferences(null)
		setSessionAccess({ permissions: [], tenantIds: null, employeeId: null })
		// Cached rows belong to the session's user and tenant scope.
		queryClient.clear()
	})

	return (
		<>
			<header class="app-topbar">
				<Show
					when={mobile()}
					fallback={
						<SidebarCorner>
							<a href={homePath()} class="app-topbar-brand">
								{APP_TITLE}
							</a>
						</SidebarCorner>
					}
				>
					<button
						type="button"
						class="app-mobile-nav-toggle"
						aria-label={t('app.openNavigation')}
						aria-expanded={navigationOpen()}
						aria-controls={navigationId}
						aria-haspopup="dialog"
						onClick={() => setNavigationOpen(true)}
					>
						<IconMenu2 size={22} aria-hidden="true" />
					</button>
				</Show>
				<TenantContextSelector scoped={fixedContext()} canAdd={canAddTenants()} />
				<CreateTicketButton scopeTenantId={singleTenant()} />
				<Show when={mobile()}>
					<div class="app-topbar-actions">
						<a href={homePath()} class="app-topbar-brand">
							{APP_TITLE}
						</a>
					</div>
				</Show>
				<div class="app-topbar-user">
					<CommandPaletteButton onOpen={() => setPaletteOpen(true)} />
					<UserMenu user={props.user} />
					<LogoutButton onLogout={props.onLogout} />
				</div>
			</header>
			<CommandPalette open={paletteOpen()} setOpen={setPaletteOpen} />
			<div class="app-body">
				<Show when={mobile()} fallback={<Sidebar />}>
					<MobileSidebar
						id={navigationId}
						open={navigationOpen()}
						onClose={closeNavigation}
					/>
				</Show>
				<div class="app-main">
					<Show when={props.user.view_as}>
						{(role: () => { id: number; name: string }) => (
							<ViewAsBanner roleName={role().name} />
						)}
					</Show>
					<main class="app-content" id="main">
						{/* Remount the page for each path so it fetches fresh data. */}
						<Show when={path()} keyed>
							{(routePath: string) => <RouteContent routePath={routePath} />}
						</Show>
					</main>
					<footer class="app-footer">
						{t('app.buildInfo', {
							version: __APP_COMMIT__
								? `${__APP_VERSION__} · ${__APP_COMMIT__}`
								: __APP_VERSION__,
							date: formatTime(__BUILD_TIME__),
						})}
					</footer>
				</div>
			</div>
		</>
	)
}

function App(): JSX.Element {
	/** undefined while the session is checked, null when signed out. */
	const [user, setUser] = createSignal<SessionUser | null | undefined>(undefined)
	const [needsSetup, setNeedsSetup] = createSignal(false)

	onMount(async () => {
		document.title = APP_TITLE
		document.addEventListener('click', onLinkClick)
		document.addEventListener('auxclick', onLinkClick)
		onCleanup(() => {
			document.removeEventListener('click', onLinkClick)
			document.removeEventListener('auxclick', onLinkClick)
		})

		const [me, setupNeeded] = await Promise.all([fetchMe(), fetchSetupStatus()])
		// A fresh database reports needsSetup; an unreachable setup endpoint
		// (null) falls back to the login form.
		setNeedsSetup(setupNeeded === true)
		setUser(setupNeeded === true ? null : me)
	})

	// A 401 can answer any request once the server session timed out.
	set_unauthorized_handler(() => setUser(null))
	// Viewing as another role changes permissions: cached rows reload under them.
	setSessionUserHandler((next: SessionUser) => {
		setUser(next)
		void queryClient.resetQueries()
	})

	// A deliberate logout starts the next login on the home page (the next user
	// may be someone else); a timed-out session (401) keeps the URL to resume.
	async function handleLogout(): Promise<void> {
		navigate('/')
		if (path() !== '/') {
			return // unsaved work: the user chose to stay
		}
		await logout()
		setUser(null)
	}

	function handleSetupDone(admin: SessionUser): void {
		setNeedsSetup(false)
		setUser(admin)
	}

	return (
		<div class="app-shell">
			<a class="skip-link" href="#main">
				{t('app.skipToContent')}
			</a>
			{/* Remount everything on a language switch so labels computed once refresh. */}
			<Show when={locale() as Locale | null} keyed>
				{(_loc: Locale) => (
					<Switch>
						<Match when={user() === undefined}>
							<main class="app-content">
								<Loading message={t('common.loading')} />
							</main>
						</Match>
						<Match when={needsSetup()}>
							<SetupPage
								onDone={handleSetupDone}
								onAlreadyDone={() => setNeedsSetup(false)}
							/>
						</Match>
						<Match when={user()}>
							{(current: () => SessionUser) => (
								<Workspace user={current()} onLogout={() => void handleLogout()} />
							)}
						</Match>
						<Match when={user() === null}>
							<LoginPage onLogin={setUser} />
						</Match>
					</Switch>
				)}
			</Show>
		</div>
	)
}

export default App
