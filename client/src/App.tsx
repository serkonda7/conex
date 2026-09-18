import {
	IconLogout,
	IconMapPin,
	IconMoon,
	IconSearch,
	IconServer,
	IconSun,
	IconTemplate,
	IconUsers,
} from '@tabler/icons-solidjs'
import { Result } from 'better-result'
import type { InputEventAndTarget } from 'shared/src/types'
import { createSignal, type JSX, Match, onMount, Show, Switch } from 'solid-js'
import { set_unauthorized_handler } from './api'
import { fetchMe, fetchSetupStatus, login, logout, setupAdmin } from './api_auth'
import { DeviceDetailPage } from './pages/device_detail'
import { DevicesPage } from './pages/devices'
import { RackDetailPage } from './pages/rack_detail'
import { SearchPage } from './pages/search'
import { SiteDetailPage } from './pages/site_detail'
import { SitesPage } from './pages/sites'
import { TemplatesPage } from './pages/templates'
import { TenantsPage } from './pages/tenants'
import { navigate, path } from './router'
import { initTheme, theme, toggleTheme } from './theme'

function go(e: MouseEvent, to: string): void {
	e.preventDefault()
	navigate(to)
}

function ThemeIcon(): JSX.Element {
	return theme() === 'dark' ? <IconSun size={16} /> : <IconMoon size={16} />
}

function LoginForm(props: {
	email: () => string
	setEmail: (v: string) => void
	password: () => string
	setPassword: (v: string) => void
	error: () => string | null
	onLogin: (e: SubmitEvent) => void
}): JSX.Element {
	return (
		<form onSubmit={props.onLogin}>
			<label class="visually-hidden" for="login-email">
				Email
			</label>
			<input
				id="login-email"
				type="email"
				placeholder="Email"
				aria-label="Email"
				required
				value={props.email()}
				onInput={(e: InputEventAndTarget) => props.setEmail(e.currentTarget.value)}
				autocomplete="username"
			/>
			<label class="visually-hidden" for="login-password">
				Password
			</label>
			<input
				id="login-password"
				type="password"
				placeholder="Password"
				aria-label="Password"
				required
				value={props.password()}
				onInput={(e: InputEventAndTarget) => props.setPassword(e.currentTarget.value)}
				autocomplete="current-password"
			/>
			<button type="submit">Sign in</button>
			<Show when={props.error()}>
				<div class="app-inline-error" role="alert">
					{props.error()}
				</div>
			</Show>
		</form>
	)
}

function SetupForm(props: {
	email: () => string
	setEmail: (v: string) => void
	password: () => string
	setPassword: (v: string) => void
	confirm: () => string
	setConfirm: (v: string) => void
	error: () => string | null
	onSetup: (e: SubmitEvent) => void
}): JSX.Element {
	return (
		<section aria-label="First-run setup">
			<h2>Welcome to Conex</h2>
			<p class="page-subtitle">Create the admin account to get started.</p>
			<form onSubmit={props.onSetup}>
				<label class="visually-hidden" for="setup-email">
					Admin email
				</label>
				<input
					id="setup-email"
					type="email"
					placeholder="Admin email"
					aria-label="Admin email"
					required
					value={props.email()}
					onInput={(e: InputEventAndTarget) => props.setEmail(e.currentTarget.value)}
					autocomplete="username"
				/>
				<label class="visually-hidden" for="setup-password">
					Password
				</label>
				<input
					id="setup-password"
					type="password"
					placeholder="Password"
					aria-label="Password"
					required
					value={props.password()}
					onInput={(e: InputEventAndTarget) => props.setPassword(e.currentTarget.value)}
					autocomplete="new-password"
				/>
				<label class="visually-hidden" for="setup-confirm">
					Confirm password
				</label>
				<input
					id="setup-confirm"
					type="password"
					placeholder="Confirm password"
					aria-label="Confirm password"
					required
					value={props.confirm()}
					onInput={(e: InputEventAndTarget) => props.setConfirm(e.currentTarget.value)}
					autocomplete="new-password"
				/>
				<button type="submit">Create admin account</button>
				<Show when={props.error()}>
					<div class="app-inline-error" role="alert">
						{props.error()}
					</div>
				</Show>
			</form>
		</section>
	)
}

// P1 shell: local-auth gate plus the tenants/sites/location-tree pages.
// Rack/device/cable pages arrive in P2-P5.
function App(): JSX.Element {
	const [isLoggedIn, setIsLoggedIn] = createSignal<boolean | null>(null)
	const [needsSetup, setNeedsSetup] = createSignal<boolean | null>(null)
	const [email, setEmail] = createSignal('')
	const [password, setPassword] = createSignal('')
	const [error, setError] = createSignal<string | null>(null)
	const [setupEmail, setSetupEmail] = createSignal('')
	const [setupPassword, setSetupPassword] = createSignal('')
	const [setupConfirm, setSetupConfirm] = createSignal('')
	const [setupError, setSetupError] = createSignal<string | null>(null)
	const [navSearch, setNavSearch] = createSignal('')

	onMount(async () => {
		initTheme()
		const [loggedIn, setupNeeded] = await Promise.all([fetchMe(), fetchSetupStatus()])
		// A fresh database reports needsSetup; an unreachable setup endpoint
		// (null) falls back to the login form.
		setNeedsSetup(setupNeeded ?? false)
		setIsLoggedIn(setupNeeded === true ? false : loggedIn)
	})

	// A 401 can answer any request once the server session timed out
	set_unauthorized_handler(() => {
		setIsLoggedIn(false)
	})

	async function handleLogin(e: SubmitEvent): Promise<void> {
		e.preventDefault()
		setError(null)
		const res = await login(email(), password())
		if (Result.isError(res)) {
			setError(res.error.message)
			return
		}
		setPassword('')
		setIsLoggedIn(true)
	}

	async function handleSetup(e: SubmitEvent): Promise<void> {
		e.preventDefault()
		setSetupError(null)

		const trimmedEmail = setupEmail().trim()
		if (!trimmedEmail) {
			setSetupError('Email is required.')
			return
		}
		if (!setupPassword()) {
			setSetupError('Password is required.')
			return
		}
		if (setupPassword() !== setupConfirm()) {
			setSetupError('Passwords do not match.')
			return
		}

		const res = await setupAdmin(trimmedEmail, setupPassword())
		if (Result.isError(res)) {
			// A 409 means another request finished setup first: fall back to login.
			if (res.error.message.toLowerCase().includes('already completed')) {
				setNeedsSetup(false)
			}
			setSetupError(res.error.message)
			return
		}
		setEmail(trimmedEmail)
		setPassword('')
		setSetupPassword('')
		setSetupConfirm('')
		setNeedsSetup(false)
		setIsLoggedIn(true)
	}

	async function handleLogout(): Promise<void> {
		await logout()
		setIsLoggedIn(false)
		setEmail('')
	}

	function route(): {
		page: string
		siteId: string | null
		rackId: string | null
		deviceId: string | null
		searchQuery: string | null
	} {
		const parts =
			path()
				.split('?')[0]
				?.split('/')
				.filter((p) => p.length > 0) ?? []
		if (parts.length === 0 || parts[0] === 'tenants') {
			return {
				page: 'tenants',
				siteId: null,
				rackId: null,
				deviceId: null,
				searchQuery: null,
			}
		}
		if (parts[0] === 'sites' && parts.length === 1) {
			return { page: 'sites', siteId: null, rackId: null, deviceId: null, searchQuery: null }
		}
		if (parts[0] === 'sites' && parts.length === 2) {
			return {
				page: 'site-detail',
				siteId: parts[1] ?? null,
				rackId: null,
				deviceId: null,
				searchQuery: null,
			}
		}
		if (parts[0] === 'racks' && parts.length === 2) {
			return {
				page: 'rack-detail',
				siteId: null,
				rackId: parts[1] ?? null,
				deviceId: null,
				searchQuery: null,
			}
		}
		if (parts[0] === 'templates') {
			return {
				page: 'templates',
				siteId: null,
				rackId: null,
				deviceId: null,
				searchQuery: null,
			}
		}
		if (parts[0] === 'devices' && parts.length === 1) {
			return {
				page: 'devices',
				siteId: null,
				rackId: null,
				deviceId: null,
				searchQuery: null,
			}
		}
		if (parts[0] === 'devices' && parts.length === 2) {
			return {
				page: 'device-detail',
				siteId: null,
				rackId: null,
				deviceId: parts[1] ?? null,
				searchQuery: null,
			}
		}
		if (parts[0] === 'search') {
			const q = new URLSearchParams(window.location.search).get('q') ?? ''
			return { page: 'search', siteId: null, rackId: null, deviceId: null, searchQuery: q }
		}
		return { page: 'not-found', siteId: null, rackId: null, deviceId: null, searchQuery: null }
	}

	return (
		<div class="app-shell">
			<a class="skip-link" href="#main">
				Skip to content
			</a>
			<Show
				when={isLoggedIn() !== null && needsSetup() !== null}
				fallback={
					<main class="app-content">
						<p class="skeleton">Loading…</p>
					</main>
				}
			>
				<Switch>
					<Match when={needsSetup()}>
						<main class="app-content app-content--centered">
							<div class="app-auth">
								<div class="app-header">
									<h1>Conex</h1>
									<button
										type="button"
										class="theme-toggle"
										onClick={toggleTheme}
										aria-label={`Switch to ${theme() === 'dark' ? 'light' : 'dark'} mode`}
									>
										<ThemeIcon /> {theme() === 'dark' ? 'Light' : 'Dark'}
									</button>
								</div>
								<SetupForm
									email={setupEmail}
									setEmail={setSetupEmail}
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
									<h1>Conex</h1>
									<button
										type="button"
										class="theme-toggle"
										onClick={toggleTheme}
										aria-label={`Switch to ${theme() === 'dark' ? 'light' : 'dark'} mode`}
									>
										<ThemeIcon /> {theme() === 'dark' ? 'Light' : 'Dark'}
									</button>
								</div>
								<LoginForm
									email={email}
									setEmail={setEmail}
									password={password}
									setPassword={setPassword}
									error={error}
									onLogin={handleLogin}
								/>
							</div>
						</main>
					</Match>
					<Match when={isLoggedIn()}>
						<aside class="app-sidebar" aria-label="Primary">
							<div class="app-brand">
								<h1>Conex</h1>
								<button
									type="button"
									class="theme-toggle theme-toggle--icon"
									onClick={toggleTheme}
									aria-label={`Switch to ${theme() === 'dark' ? 'light' : 'dark'} mode`}
								>
									<ThemeIcon />
								</button>
							</div>
							<form
								class="app-search"
								onSubmit={(e: SubmitEvent): void => {
									e.preventDefault()
									const q = navSearch().trim()
									if (q) {
										navigate(`/search?q=${encodeURIComponent(q)}`)
									} else {
										navigate('/search')
									}
								}}
							>
								<label class="visually-hidden" for="nav-search">
									Global search
								</label>
								<input
									id="nav-search"
									placeholder="Search…"
									value={navSearch()}
									onInput={(e: Event & { currentTarget: HTMLInputElement }) =>
										setNavSearch(e.currentTarget.value)
									}
									aria-label="Global search"
								/>
							</form>
							<p class="app-nav-label">Inventory</p>
							<nav class="app-nav">
								<a
									href="/tenants"
									class={
										path().startsWith('/tenants') || path() === '/'
											? 'active'
											: ''
									}
									aria-current={
										path().startsWith('/tenants') || path() === '/'
											? 'page'
											: undefined
									}
									onClick={(e: MouseEvent): void => go(e, '/tenants')}
								>
									<span aria-hidden="true" class="app-nav-icon">
										<IconUsers size={16} />
									</span>
									Tenants
								</a>
								<a
									href="/sites"
									class={path().startsWith('/sites') ? 'active' : ''}
									aria-current={path().startsWith('/sites') ? 'page' : undefined}
									onClick={(e: MouseEvent): void => go(e, '/sites')}
								>
									<span aria-hidden="true" class="app-nav-icon">
										<IconMapPin size={16} />
									</span>
									Sites
								</a>
								<a
									href="/templates"
									class={path().startsWith('/templates') ? 'active' : ''}
									aria-current={
										path().startsWith('/templates') ? 'page' : undefined
									}
									onClick={(e: MouseEvent): void => go(e, '/templates')}
								>
									<span aria-hidden="true" class="app-nav-icon">
										<IconTemplate size={16} />
									</span>
									Templates
								</a>
								<a
									href="/devices"
									class={path().startsWith('/devices') ? 'active' : ''}
									aria-current={
										path().startsWith('/devices') ? 'page' : undefined
									}
									onClick={(e: MouseEvent): void => go(e, '/devices')}
								>
									<span aria-hidden="true" class="app-nav-icon">
										<IconServer size={16} />
									</span>
									Devices
								</a>
								<a
									href="/search"
									class={path().startsWith('/search') ? 'active' : ''}
									aria-current={path().startsWith('/search') ? 'page' : undefined}
									onClick={(e: MouseEvent): void => go(e, '/search')}
								>
									<span aria-hidden="true" class="app-nav-icon">
										<IconSearch size={16} />
									</span>
									Search
								</a>
							</nav>
							<div class="app-sidebar-footer">
								<button type="button" class="app-signout" onClick={handleLogout}>
									<span aria-hidden="true" class="app-nav-icon">
										<IconLogout size={16} />
									</span>
									<span>Sign out ({email() || '…'})</span>
								</button>
							</div>
						</aside>
						<main class="app-content" id="main">
							<Switch>
								<Match when={route().page === 'tenants'}>
									<TenantsPage />
								</Match>
								<Match when={route().page === 'sites'}>
									<SitesPage />
								</Match>
								<Match
									when={route().page === 'site-detail' && route().siteId !== null}
								>
									<SiteDetailPage id={route().siteId as string} />
								</Match>
								<Match
									when={route().page === 'rack-detail' && route().rackId !== null}
								>
									<RackDetailPage id={route().rackId as string} />
								</Match>
								<Match when={route().page === 'templates'}>
									<TemplatesPage />
								</Match>
								<Match when={route().page === 'devices'}>
									<DevicesPage />
								</Match>
								<Match
									when={
										route().page === 'device-detail' &&
										route().deviceId !== null
									}
								>
									<DeviceDetailPage id={route().deviceId as string} />
								</Match>
								<Match when={route().page === 'search'}>
									<SearchPage initial={route().searchQuery ?? ''} />
								</Match>
								<Match when={route().page === 'not-found'}>
									<p>Not found.</p>
								</Match>
							</Switch>
						</main>
					</Match>
				</Switch>
			</Show>
		</div>
	)
}

export default App
