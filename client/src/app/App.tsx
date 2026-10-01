/**
 * App shell: the session gate (first-run setup, login) and, once signed in,
 * the top bar, sidebar, tab strip and one mounted page per tab.
 */
import {
	createEffect,
	createSignal,
	For,
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
import { activeTabId, goTo, type TabState, tabs } from '../lib/router'
import { setSessionAccess } from '../lib/session'
import { refreshTenantContext, setTenantContextScoped } from '../lib/tenant_context'
import { APP_TITLE, LoginPage, SetupPage } from './auth_page'
import { RouteContent } from './route_content'
import { Sidebar } from './sidebar'
import { TabBar } from './tab_bar'
import { TenantContextSelector } from './tenant_context_selector'

/**
 * Routes in-app anchors that have no click handler of their own through
 * `goTo`, and middle clicks (which never fire `click`) to a new tab.
 * Anchors whose handler already called `goTo` are skipped.
 */
function onLinkClick(e: MouseEvent): void {
	if (e.defaultPrevented || e.button > 1 || !(e.target instanceof Element)) {
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
	// Users limited to one tenant: the context selector is fixed.
	const isScoped = (): boolean => props.user.tenant_id !== null
	// Tenant create is limited to global users with `edit` (server-enforced).
	const canAddTenants = (): boolean => props.user.permissions.includes('edit') && !isScoped()

	createEffect(() => {
		setSessionAccess({ permissions: props.user.permissions, scoped: isScoped() })
		setTenantContextScoped(isScoped())
		if (props.user.permissions.includes('view')) {
			void refreshTenantContext()
		}
	})
	onCleanup(() => {
		setSessionAccess({ permissions: [], scoped: false })
	})

	return (
		<>
			<header class="app-topbar">
				<TenantContextSelector scoped={isScoped()} canAdd={canAddTenants()} />
				<div class="app-topbar-actions">
					<a href="/dashboard" class="app-topbar-brand">
						{APP_TITLE}
					</a>
				</div>
			</header>
			<div class="app-body">
				<Sidebar user={props.user} onLogout={props.onLogout} />
				<div class="app-main">
					<TabBar />
					<main class="app-content" id="main">
						<For each={tabs()}>
							{(tab: TabState) => (
								<div
									class="tab-pane"
									data-tab-id={tab.id}
									hidden={tab.id !== activeTabId()}
									aria-hidden={tab.id !== activeTabId()}
								>
									<RouteContent routePath={tab.path} tabId={tab.id} />
								</div>
							)}
						</For>
					</main>
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

	async function handleLogout(): Promise<void> {
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
