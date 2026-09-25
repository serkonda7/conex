import { IconChevronDown, IconDownload, IconLogout, IconPlus, IconX } from '@tabler/icons-solidjs'
import { Result } from 'better-result'
import type { InputEventAndTarget } from 'shared/src/types'
import {
	createEffect,
	createMemo,
	createSignal,
	For,
	type JSX,
	Match,
	onCleanup,
	onMount,
	Show,
	Switch,
} from 'solid-js'
import { Dynamic } from 'solid-js/web'
import { set_unauthorized_handler } from './api'
import { fetchMe, fetchSetupStatus, login, logout, type SessionUser, setupAdmin } from './api_auth'
import { Breadcrumbs } from './components/breadcrumbs'
import { t } from './i18n'
import {
	activateTab,
	activeTabId,
	closeOtherTabs,
	closeTab,
	closeTabsToRight,
	duplicateTab,
	goTo,
	path,
	type TabState,
	tabPathContext,
	tabs,
} from './router'
import {
	matchRoute,
	type RouteMatch,
	routeCrumbs,
	routeSection,
	SECTIONS,
	type Section,
	tabTitle,
} from './routes'

const APP_TITLE = 'CoNetBox'

function LoginForm(props: {
	username: () => string
	setUsername: (v: string) => void
	password: () => string
	setPassword: (v: string) => void
	error: () => string | null
	onLogin: (e: SubmitEvent) => void
}): JSX.Element {
	return (
		<form onSubmit={props.onLogin}>
			<label class="visually-hidden" for="login-username">
				{t('auth.username')}
			</label>
			<input
				id="login-username"
				type="text"
				placeholder={t('auth.username')}
				aria-label={t('auth.username')}
				required
				value={props.username()}
				onInput={(e: InputEventAndTarget) => props.setUsername(e.currentTarget.value)}
				autocomplete="username"
			/>
			<label class="visually-hidden" for="login-password">
				{t('auth.password')}
			</label>
			<input
				id="login-password"
				type="password"
				placeholder={t('auth.password')}
				aria-label={t('auth.password')}
				required
				value={props.password()}
				onInput={(e: InputEventAndTarget) => props.setPassword(e.currentTarget.value)}
				autocomplete="current-password"
			/>
			<button type="submit">{t('auth.login')}</button>
			<Show when={props.error()}>
				<div class="app-inline-error" role="alert">
					{props.error()}
				</div>
			</Show>
		</form>
	)
}

function SetupForm(props: {
	username: () => string
	setUsername: (v: string) => void
	password: () => string
	setPassword: (v: string) => void
	confirm: () => string
	setConfirm: (v: string) => void
	error: () => string | null
	onSetup: (e: SubmitEvent) => void
}): JSX.Element {
	return (
		<section aria-label={t('auth.setup')}>
			<h2>{t('auth.welcome')}</h2>
			<p class="page-subtitle">{t('auth.setupIntro')}</p>
			<form onSubmit={props.onSetup}>
				<label class="visually-hidden" for="setup-username">
					{t('auth.adminUsername')}
				</label>
				<input
					id="setup-username"
					type="text"
					placeholder={t('auth.adminUsername')}
					aria-label={t('auth.adminUsername')}
					required
					value={props.username()}
					onInput={(e: InputEventAndTarget) => props.setUsername(e.currentTarget.value)}
					autocomplete="username"
				/>
				<label class="visually-hidden" for="setup-password">
					{t('auth.password')}
				</label>
				<input
					id="setup-password"
					type="password"
					placeholder={t('auth.password')}
					aria-label={t('auth.password')}
					required
					value={props.password()}
					onInput={(e: InputEventAndTarget) => props.setPassword(e.currentTarget.value)}
					autocomplete="new-password"
				/>
				<label class="visually-hidden" for="setup-confirm">
					{t('auth.confirmPassword')}
				</label>
				<input
					id="setup-confirm"
					type="password"
					placeholder={t('auth.confirmPassword')}
					aria-label={t('auth.confirmPassword')}
					required
					value={props.confirm()}
					onInput={(e: InputEventAndTarget) => props.setConfirm(e.currentTarget.value)}
					autocomplete="new-password"
				/>
				<button type="submit">{t('auth.createAdmin')}</button>
				<Show when={props.error()}>
					<div class="app-inline-error" role="alert">
						{props.error()}
					</div>
				</Show>
			</form>
		</section>
	)
}

// NetBox-style nav row: label link plus a quick-add "+" shown on hover/active.
// `addHref` wires a real shortcut; omit it for a dummy placeholder button.
function NavItem(props: {
	href: string
	active: boolean
	icon: JSX.Element
	label: string
	addHref?: string
	importHref?: string
}): JSX.Element {
	function goLink(e: MouseEvent): void {
		goTo(e, props.href)
	}

	function goAdd(e: MouseEvent): void {
		e.stopPropagation()
		if (props.addHref) {
			goTo(e, props.addHref)
		}
	}

	function goImport(e: MouseEvent): void {
		e.stopPropagation()
		if (props.importHref) {
			goTo(e, props.importHref)
		}
	}

	return (
		<div class={props.active ? 'app-nav-item active' : 'app-nav-item'}>
			<a
				href={props.href}
				class={props.active ? 'active' : ''}
				aria-current={props.active ? 'page' : undefined}
				onClick={goLink}
			>
				<span aria-hidden="true" class="app-nav-icon">
					{props.icon}
				</span>
				{props.label}
			</a>
			{props.addHref ? (
				<button
					type="button"
					class="app-nav-add"
					aria-label={t('app.navAdd', { label: props.label })}
					title={t('app.navAdd', { label: props.label })}
					onClick={goAdd}
				>
					<span aria-hidden="true" class="app-nav-add-icon">
						<IconPlus size={14} />
					</span>
				</button>
			) : (
				<button
					type="button"
					class="app-nav-add"
					disabled
					aria-label={t('app.navAddSoon', { label: props.label })}
					title={t('app.navAddSoon', { label: props.label })}
				>
					<span aria-hidden="true" class="app-nav-add-icon">
						<IconPlus size={14} />
					</span>
				</button>
			)}
			{props.importHref ? (
				<button
					type="button"
					class="app-nav-add app-nav-import"
					aria-label={t('app.navImport', { label: props.label })}
					title={t('app.navImport', { label: props.label })}
					onClick={goImport}
				>
					<span aria-hidden="true" class="app-nav-add-icon">
						<IconDownload size={14} />
					</span>
				</button>
			) : null}
		</div>
	)
}

/** Tab tooltip: the page's full breadcrumb trail, else its title. */
function tabTooltip(tab: TabState): string {
	const match = matchRoute(tab.path, true)
	const crumbs = match ? routeCrumbs(tab.path, match) : []
	return crumbs.length > 0 ? crumbs.map((c) => c.label).join(' › ') : tabTitle(tab.path)
}

/** Icon of the tab's section from the route table, if it has one. */
function TabIcon(props: { path: string }): JSX.Element {
	return (
		<Show when={routeSection(props.path)?.icon}>
			{(icon: () => NonNullable<Section['icon']>) => (
				<span aria-hidden="true" class="tab-icon">
					<Dynamic component={icon()} size={14} />
				</span>
			)}
		</Show>
	)
}

/** Right-click menu of one tab. */
function TabMenu(props: { tabId: number; x: number; y: number; onClose: () => void }): JSX.Element {
	const index = (): number => tabs().findIndex((tab) => tab.id === props.tabId)
	function run(action: (id: number) => void): void {
		action(props.tabId)
		props.onClose()
	}
	return (
		<div
			class="tab-menu tab-context-menu"
			role="menu"
			style={{ left: `${props.x}px`, top: `${props.y}px` }}
		>
			<button
				type="button"
				role="menuitem"
				class="tab-menu-item"
				onClick={() => run(duplicateTab)}
			>
				{t('tab.duplicate')}
			</button>
			<Show when={tabs().length > 1}>
				<button
					type="button"
					role="menuitem"
					class="tab-menu-item"
					onClick={() => run(closeTab)}
				>
					{t('common.close')}
				</button>
				<button
					type="button"
					role="menuitem"
					class="tab-menu-item"
					onClick={() => run(closeOtherTabs)}
				>
					{t('tab.closeOthers')}
				</button>
			</Show>
			<Show when={index() < tabs().length - 1}>
				<button
					type="button"
					role="menuitem"
					class="tab-menu-item"
					onClick={() => run(closeTabsToRight)}
				>
					{t('tab.closeToRight')}
				</button>
			</Show>
		</div>
	)
}

/**
 * In-app tab strip: each entry keeps its page mounted in the background so
 * opening an add/edit form never discards the list/detail behind it. When
 * the tabs no longer fit, a dropdown at the end lists all of them.
 */
function TabBar(): JSX.Element {
	const [menu, setMenu] = createSignal<{ tabId: number; x: number; y: number } | null>(null)
	const [listOpen, setListOpen] = createSignal(false)
	const [overflowing, setOverflowing] = createSignal(false)
	let strip: HTMLDivElement | undefined

	function measure(): void {
		if (strip) {
			setOverflowing(strip.scrollWidth > strip.clientWidth)
		}
	}

	onMount(() => {
		const observer = new ResizeObserver(measure)
		if (strip) {
			observer.observe(strip)
		}
		const onPointerDown = (e: PointerEvent): void => {
			if (
				e.target instanceof Element &&
				e.target.closest('.tab-menu, .tab-list-toggle') === null
			) {
				setMenu(null)
				setListOpen(false)
			}
		}
		const onKeyDown = (e: KeyboardEvent): void => {
			if (e.key === 'Escape') {
				setMenu(null)
				setListOpen(false)
			}
		}
		document.addEventListener('pointerdown', onPointerDown)
		document.addEventListener('keydown', onKeyDown)
		onCleanup(() => {
			observer.disconnect()
			document.removeEventListener('pointerdown', onPointerDown)
			document.removeEventListener('keydown', onKeyDown)
		})
	})

	// Titles change as pages load, so re-measure whenever they do, and keep
	// the active tab scrolled into view.
	createEffect(() => {
		for (const tab of tabs()) {
			tabTitle(tab.path)
		}
		const id = activeTabId()
		requestAnimationFrame(() => {
			measure()
			strip
				?.querySelector(`[data-tab-button="${id}"]`)
				?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
		})
	})

	return (
		<div class="tab-bar-wrap">
			<div class="tab-bar" role="tablist" aria-label={t('app.openPages')} ref={strip}>
				<For each={tabs()}>
					{(tab: TabState) => (
						<div
							role="tab"
							data-tab-button={tab.id}
							aria-selected={tab.id === activeTabId()}
							aria-label={tabTitle(tab.path)}
							title={tabTooltip(tab)}
							tabIndex={0}
							class={tab.id === activeTabId() ? 'tab-item active' : 'tab-item'}
							onClick={() => activateTab(tab.id)}
							onKeyDown={(e: KeyboardEvent): void => {
								if (e.key === 'Enter' || e.key === ' ') {
									e.preventDefault()
									activateTab(tab.id)
								}
							}}
							onAuxClick={(e: MouseEvent): void => {
								if (e.button === 1) {
									e.preventDefault()
									closeTab(tab.id)
								}
							}}
							onContextMenu={(e: MouseEvent): void => {
								e.preventDefault()
								setListOpen(false)
								// Keep the menu (about 14rem wide) inside the viewport.
								const x = Math.min(e.clientX, window.innerWidth - 240)
								setMenu({ tabId: tab.id, x: Math.max(0, x), y: e.clientY })
							}}
						>
							<TabIcon path={tab.path} />
							<span class="tab-title">{tabTitle(tab.path)}</span>
							<Show when={tabs().length > 1}>
								<button
									type="button"
									class="tab-close"
									aria-label={t('app.closeTab', { title: tabTitle(tab.path) })}
									title={t('app.closeTab', { title: tabTitle(tab.path) })}
									onClick={(e: MouseEvent): void => {
										e.stopPropagation()
										closeTab(tab.id)
									}}
								>
									<span aria-hidden="true" class="tab-close-icon">
										<IconX size={12} />
									</span>
								</button>
							</Show>
						</div>
					)}
				</For>
			</div>
			<Show when={overflowing()}>
				<div class="tab-list">
					<button
						type="button"
						class="tab-list-toggle"
						aria-haspopup="menu"
						aria-expanded={listOpen()}
						aria-label={t('app.allTabs')}
						title={t('app.allTabs')}
						onClick={() => {
							setMenu(null)
							setListOpen(!listOpen())
						}}
					>
						<span aria-hidden="true" class="tab-close-icon">
							<IconChevronDown size={14} />
						</span>
					</button>
					<Show when={listOpen()}>
						<div class="tab-menu tab-list-menu" role="menu">
							<For each={tabs()}>
								{(tab: TabState) => (
									<button
										type="button"
										role="menuitem"
										class={
											tab.id === activeTabId()
												? 'tab-menu-item active'
												: 'tab-menu-item'
										}
										title={tabTooltip(tab)}
										onClick={() => {
											setListOpen(false)
											activateTab(tab.id)
										}}
									>
										<TabIcon path={tab.path} />
										<span class="tab-title">{tabTitle(tab.path)}</span>
									</button>
								)}
							</For>
						</div>
					</Show>
				</div>
			</Show>
			<Show when={menu()}>
				{(m: () => { tabId: number; x: number; y: number }) => (
					<TabMenu tabId={m().tabId} x={m().x} y={m().y} onClose={() => setMenu(null)} />
				)}
			</Show>
		</div>
	)
}

/** Page content for one tab; `routePath` is that tab's own path. */
function RouteContent(props: { routePath: string; tabId: number; isAdmin: boolean }): JSX.Element {
	const TabContext = tabPathContext()
	// A pane remounts whenever its tab's path changes, so only an admin-role
	// change can re-resolve the route: keep the page mounted unless the
	// resolved page itself differs.
	const match = createMemo(
		(): RouteMatch | null => matchRoute(props.routePath, props.isAdmin),
		undefined,
		{
			equals: (a: RouteMatch | null, b: RouteMatch | null): boolean => a?.page === b?.page,
		},
	)
	// Tabs stay mounted in the background, so autofocus-on-mount only fires
	// on first visit. Refocus the page's autofocus target on activation, but
	// leave focus alone when it is already inside this tab (e.g. switching
	// back mid-edit).
	createEffect(() => {
		if (activeTabId() !== props.tabId) {
			return
		}
		const pane = document.querySelector<HTMLElement>(`[data-tab-id="${props.tabId}"]`)
		if (!pane) {
			return
		}
		const focused = document.activeElement
		if (focused instanceof HTMLElement && pane.contains(focused)) {
			return
		}
		pane.querySelector<HTMLElement>('[data-autofocus]')?.focus()
	})
	return (
		<TabContext.Provider value={props.routePath}>
			<Show when={match()} keyed fallback={<p>{t('app.pageNotFound')}</p>}>
				{(m: RouteMatch) => (
					<>
						<Breadcrumbs crumbs={routeCrumbs(props.routePath, m)} />
						{m.kind === 'detail' || m.kind === 'edit' ? (
							<Dynamic component={m.page} id={m.id} />
						) : (
							<Dynamic component={m.page} />
						)}
					</>
				)}
			</Show>
		</TabContext.Provider>
	)
}

// P1 shell: local-auth gate plus the tenants/sites/location-tree pages.
// Rack/device/cable pages arrive in P2-P5.
function App(): JSX.Element {
	const [isLoggedIn, setIsLoggedIn] = createSignal<boolean | null>(null)
	const [needsSetup, setNeedsSetup] = createSignal<boolean | null>(null)
	const [username, setUsername] = createSignal('')
	const [password, setPassword] = createSignal('')
	const [error, setError] = createSignal<string | null>(null)
	const [setupUsername, setSetupUsername] = createSignal('')
	const [setupPassword, setSetupPassword] = createSignal('')
	const [setupConfirm, setSetupConfirm] = createSignal('')
	const [setupError, setSetupError] = createSignal<string | null>(null)
	const [currentUser, setCurrentUser] = createSignal<SessionUser | null>(null)
	const [userMenuOpen, setUserMenuOpen] = createSignal(false)

	onMount(async () => {
		document.title = APP_TITLE

		const onDocClick = (e: MouseEvent): void => {
			if (!(e.target instanceof Element)) {
				return
			}
			if (e.target.closest('.app-user-menu') === null) {
				setUserMenuOpen(false)
			}
		}
		// Routes in-app anchors that have no click handler of their own
		// through `goTo`, and middle clicks (which never fire `click`) to a
		// new tab. Anchors whose handler already called `goTo` are skipped.
		const onLinkClick = (e: MouseEvent): void => {
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
			if (!href.startsWith('/') || href.startsWith('//')) {
				return
			}
			goTo(e, href)
		}
		document.addEventListener('click', onDocClick)
		document.addEventListener('click', onLinkClick)
		document.addEventListener('auxclick', onLinkClick)
		onCleanup(() => {
			document.removeEventListener('click', onDocClick)
			document.removeEventListener('click', onLinkClick)
			document.removeEventListener('auxclick', onLinkClick)
		})

		const [me, setupNeeded] = await Promise.all([fetchMe(), fetchSetupStatus()])
		// A fresh database reports needsSetup; an unreachable setup endpoint
		// (null) falls back to the login form.
		setNeedsSetup(setupNeeded ?? false)
		setCurrentUser(me)
		setIsLoggedIn(setupNeeded === true ? false : me !== null)
	})

	// A 401 can answer any request once the server session timed out
	set_unauthorized_handler(() => {
		setIsLoggedIn(false)
		setCurrentUser(null)
		setUserMenuOpen(false)
	})

	async function handleLogin(e: SubmitEvent): Promise<void> {
		e.preventDefault()
		setError(null)
		const res = await login(username(), password())
		if (Result.isError(res)) {
			setError(res.error.message)
			return
		}
		setPassword('')
		const me =
			(await fetchMe()) ??
			({ username: username().trim(), role: 'viewer', tenant_id: null } as SessionUser)
		setCurrentUser(me)
		setIsLoggedIn(me !== null)
	}

	async function handleSetup(e: SubmitEvent): Promise<void> {
		e.preventDefault()
		setSetupError(null)

		const trimmedUsername = setupUsername().trim()
		if (!trimmedUsername) {
			setSetupError(t('auth.usernameRequired'))
			return
		}
		if (!setupPassword()) {
			setSetupError(t('auth.passwordRequired'))
			return
		}
		if (setupPassword() !== setupConfirm()) {
			setSetupError(t('auth.passwordMismatch'))
			return
		}

		const res = await setupAdmin(trimmedUsername, setupPassword())
		if (Result.isError(res)) {
			// A 409 means another request finished setup first: fall back to login.
			if (res.error.message.toLowerCase().includes('already completed')) {
				setNeedsSetup(false)
			}
			setSetupError(res.error.message)
			return
		}
		setUsername(trimmedUsername)
		setPassword('')
		setSetupPassword('')
		setSetupConfirm('')
		setNeedsSetup(false)
		setCurrentUser({ username: trimmedUsername, role: 'admin', tenant_id: null })
		setIsLoggedIn(true)
	}

	async function handleLogout(): Promise<void> {
		setUserMenuOpen(false)
		await logout()
		setIsLoggedIn(false)
		setCurrentUser(null)
		setUsername('')
	}

	return (
		<div class="app-shell">
			<a class="skip-link" href="#main">
				{t('app.skipToContent')}
			</a>
			<Show
				when={isLoggedIn() !== null && needsSetup() !== null}
				fallback={
					<main class="app-content">
						<p class="skeleton">{t('common.loading')}</p>
					</main>
				}
			>
				<Switch>
					<Match when={needsSetup()}>
						<main class="app-content app-content--centered">
							<div class="app-auth">
								<div class="app-header">
									<h1>{APP_TITLE}</h1>
								</div>
								<SetupForm
									username={setupUsername}
									setUsername={setSetupUsername}
									password={setupPassword}
									setPassword={setSetupPassword}
									confirm={setupConfirm}
									setConfirm={setSetupConfirm}
									error={setupError}
									onSetup={handleSetup}
								/>
							</div>
						</main>
					</Match>
					<Match when={!isLoggedIn()}>
						<main class="app-content app-content--centered">
							<div class="app-auth">
								<div class="app-header">
									<h1>{APP_TITLE}</h1>
								</div>
								<LoginForm
									username={username}
									setUsername={setUsername}
									password={password}
									setPassword={setPassword}
									error={error}
									onLogin={handleLogin}
								/>
							</div>
						</main>
					</Match>
					<Match when={isLoggedIn()}>
						<header class="app-topbar">
							<a
								href="/tenants"
								class="app-topbar-brand"
								onClick={(e: MouseEvent): void => goTo(e, '/tenants')}
							>
								{APP_TITLE}
							</a>
							<div class="app-topbar-actions">
								<div class="app-user-menu">
									<button
										type="button"
										class="app-user-button"
										aria-haspopup="menu"
										aria-expanded={userMenuOpen()}
										aria-label={t('app.accountNamed', {
											name: currentUser()?.username ?? '…',
										})}
										onClick={() => setUserMenuOpen(!userMenuOpen())}
										onKeyDown={(e: KeyboardEvent): void => {
											if (e.key === 'Escape') {
												setUserMenuOpen(false)
											}
										}}
									>
										<span class="app-user-username">
											{currentUser()?.username ?? '…'}
										</span>
									</button>
									<Show when={userMenuOpen()}>
										<div
											class="app-user-dropdown"
											role="menu"
											aria-label={t('app.account')}
										>
											<button
												type="button"
												role="menuitem"
												class="app-user-logout"
												onClick={handleLogout}
											>
												<span aria-hidden="true" class="app-nav-icon">
													<IconLogout size={16} />
												</span>
												{t('app.logout')}
											</button>
										</div>
									</Show>
								</div>
							</div>
						</header>
						<div class="app-body">
							<aside class="app-sidebar" aria-label={t('app.mainNavigation')}>
								<p class="app-nav-label">{t('app.inventory')}</p>
								<nav class="app-nav">
									<For
										each={SECTIONS.filter(
											(section) =>
												section.icon !== undefined &&
												section.list !== undefined &&
												(section.adminOnly !== true ||
													currentUser()?.role === 'admin'),
										)}
									>
										{(section: Section): JSX.Element => (
											<NavItem
												href={`/${section.path}`}
												active={routeSection(path()) === section}
												icon={
													<Dynamic component={section.icon} size={16} />
												}
												label={section.noun(2)}
												addHref={
													section.add ? `/${section.path}/add` : undefined
												}
												importHref={
													section.import
														? `/${section.path}/import`
														: undefined
												}
											/>
										)}
									</For>
								</nav>
							</aside>
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
												<RouteContent
													routePath={tab.path}
													tabId={tab.id}
													isAdmin={currentUser()?.role === 'admin'}
												/>
											</div>
										)}
									</For>
								</main>
							</div>
						</div>
					</Match>
				</Switch>
			</Show>
		</div>
	)
}

export default App
