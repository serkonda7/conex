import { Result } from 'better-result'
import type { InputEventAndTarget } from 'shared/src/types'
import { createSignal, type JSX, Match, onMount, Show, Switch } from 'solid-js'
import { fetch_health, set_unauthorized_handler } from './api'
import { fetchMe, login, logout } from './api_auth'
import { DeviceDetailPage } from './pages/device_detail'
import { DevicesPage } from './pages/devices'
import { RackDetailPage } from './pages/rack_detail'
import { SearchPage } from './pages/search'
import { SiteDetailPage } from './pages/site_detail'
import { SitesPage } from './pages/sites'
import { TemplatesPage } from './pages/templates'
import { TenantsPage } from './pages/tenants'
import { navigate, path } from './router'

function go(e: MouseEvent, to: string): void {
	e.preventDefault()
	navigate(to)
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
			<input
				type="email"
				placeholder="Email"
				value={props.email()}
				onInput={(e: InputEventAndTarget) => props.setEmail(e.currentTarget.value)}
				autocomplete="username"
			/>
			<input
				type="password"
				placeholder="Password"
				value={props.password()}
				onInput={(e: InputEventAndTarget) => props.setPassword(e.currentTarget.value)}
				autocomplete="current-password"
			/>
			<button type="submit">Sign in</button>
			<Show when={props.error()}>
				<div class="app-inline-error">{props.error()}</div>
			</Show>
		</form>
	)
}

// P1 shell: local-auth gate plus the tenants/sites/location-tree pages.
// Rack/device/cable pages arrive in P2-P5.
function App(): JSX.Element {
	const [isLoggedIn, setIsLoggedIn] = createSignal<boolean | null>(null)
	const [health, setHealth] = createSignal<string>('…')
	const [email, setEmail] = createSignal('')
	const [password, setPassword] = createSignal('')
	const [error, setError] = createSignal<string | null>(null)
	const [navSearch, setNavSearch] = createSignal('')

	onMount(async () => {
		setIsLoggedIn(await fetchMe())
		const res = await fetch_health()
		if (Result.isError(res)) {
			setHealth(`unreachable: ${res.error.message}`)
		} else {
			setHealth(`${res.value.status} (v${res.value.version})`)
		}
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
		<main>
			<h1>Conex</h1>
			<p>
				Server health: <code>{health()}</code>
			</p>
			<Show when={isLoggedIn() !== null} fallback={<p>Loading…</p>}>
				<Switch>
					<Match when={!isLoggedIn()}>
						<LoginForm
							email={email}
							setEmail={setEmail}
							password={password}
							setPassword={setPassword}
							error={error}
							onLogin={handleLogin}
						/>
					</Match>
					<Match when={isLoggedIn()}>
						<nav>
							<a href="/tenants" onClick={(e: MouseEvent): void => go(e, '/tenants')}>
								Tenants
							</a>{' '}
							|{' '}
							<a href="/sites" onClick={(e: MouseEvent): void => go(e, '/sites')}>
								Sites
							</a>{' '}
							|{' '}
							<a
								href="/templates"
								onClick={(e: MouseEvent): void => go(e, '/templates')}
							>
								Templates
							</a>{' '}
							|{' '}
							<a href="/devices" onClick={(e: MouseEvent): void => go(e, '/devices')}>
								Devices
							</a>{' '}
							|{' '}
							<form
								style={{ display: 'inline' }}
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
								<input
									placeholder="Search…"
									value={navSearch()}
									onInput={(e: Event & { currentTarget: HTMLInputElement }) =>
										setNavSearch(e.currentTarget.value)
									}
									aria-label="Global search"
								/>{' '}
								<button type="submit">Go</button>
							</form>{' '}
							|{' '}
							<button type="button" onClick={handleLogout}>
								Sign out ({email() || '…'})
							</button>
						</nav>
						<Switch>
							<Match when={route().page === 'tenants'}>
								<TenantsPage />
							</Match>
							<Match when={route().page === 'sites'}>
								<SitesPage />
							</Match>
							<Match when={route().page === 'site-detail' && route().siteId !== null}>
								<SiteDetailPage id={route().siteId as string} />
							</Match>
							<Match when={route().page === 'rack-detail' && route().rackId !== null}>
								<RackDetailPage id={route().rackId as string} />
							</Match>
							<Match when={route().page === 'templates'}>
								<TemplatesPage />
							</Match>
							<Match when={route().page === 'devices'}>
								<DevicesPage />
							</Match>
							<Match
								when={route().page === 'device-detail' && route().deviceId !== null}
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
					</Match>
				</Switch>
			</Show>
		</main>
	)
}

export default App
