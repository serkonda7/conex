import {
	IconBox,
	IconBuildingFactory,
	IconCpu,
	IconDownload,
	IconFolder,
	IconLink,
	IconLocation,
	IconLock,
	IconLogout,
	IconMapPin,
	IconNetwork,
	IconPlug,
	IconPlus,
	IconServer,
	IconTemplate,
	IconUsers,
} from '@tabler/icons-solidjs'
import { Result } from 'better-result'
import type { InputEventAndTarget } from 'shared/src/types'
import { createSignal, type JSX, Match, onCleanup, onMount, Show, Switch } from 'solid-js'
import { set_unauthorized_handler } from './api'
import { fetchMe, fetchSetupStatus, login, logout, type SessionUser, setupAdmin } from './api_auth'
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
import { navigate, parseId, path } from './router'

function go(e: MouseEvent, to: string): void {
	e.preventDefault()
	navigate(to)
}

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
				Username
			</label>
			<input
				id="login-username"
				type="text"
				placeholder="Username"
				aria-label="Username"
				required
				value={props.username()}
				onInput={(e: InputEventAndTarget) => props.setUsername(e.currentTarget.value)}
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
		<section aria-label="First-run setup">
			<h2>Welcome to Conex</h2>
			<p class="page-subtitle">Create the admin account to get started.</p>
			<form onSubmit={props.onSetup}>
				<label class="visually-hidden" for="setup-username">
					Admin username
				</label>
				<input
					id="setup-username"
					type="text"
					placeholder="Admin username"
					aria-label="Admin username"
					required
					value={props.username()}
					onInput={(e: InputEventAndTarget) => props.setUsername(e.currentTarget.value)}
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
		e.preventDefault()
		navigate(props.href)
	}

	function goAdd(e: MouseEvent): void {
		e.preventDefault()
		e.stopPropagation()
		if (props.addHref) {
			navigate(props.addHref)
		}
	}

	function goImport(e: MouseEvent): void {
		e.preventDefault()
		e.stopPropagation()
		if (props.importHref) {
			navigate(props.importHref)
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
					aria-label={`Add ${props.label}`}
					title={`Add ${props.label}`}
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
					aria-label={`Add ${props.label} (coming soon)`}
					title={`Add ${props.label} (coming soon)`}
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
					aria-label={`Import ${props.label}`}
					title={`Import ${props.label}`}
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
		const [me, setupNeeded] = await Promise.all([fetchMe(), fetchSetupStatus()])
		// A fresh database reports needsSetup; an unreachable setup endpoint
		// (null) falls back to the login form.
		setNeedsSetup(setupNeeded ?? false)
		setCurrentUser(me)
		setIsLoggedIn(setupNeeded === true ? false : me !== null)

		const onDocClick = (e: MouseEvent): void => {
			if (!(e.target instanceof Element)) {
				return
			}
			if (e.target.closest('.app-user-menu') === null) {
				setUserMenuOpen(false)
			}
		}
		document.addEventListener('click', onDocClick)
		onCleanup(() => {
			document.removeEventListener('click', onDocClick)
		})
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
			setSetupError('Username is required.')
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

	function emptyRoute(page: string): {
		page: string
		tenantId: number | null
		siteId: number | null
		siteGroupId: number | null
		locationId: number | null
		rackId: number | null
		deviceId: number | null
		deviceTypeId: number | null
		manufacturerId: number | null
		userId: number | null
	} {
		return {
			page,
			tenantId: null,
			siteId: null,
			siteGroupId: null,
			locationId: null,
			rackId: null,
			deviceId: null,
			deviceTypeId: null,
			manufacturerId: null,
			userId: null,
		}
	}

	function route(): {
		page: string
		tenantId: number | null
		siteId: number | null
		siteGroupId: number | null
		locationId: number | null
		rackId: number | null
		deviceId: number | null
		deviceTypeId: number | null
		manufacturerId: number | null
		userId: number | null
	} {
		const parts =
			path()
				.split('?')[0]
				?.split('/')
				.filter((p) => p.length > 0) ?? []
		if (parts.length === 0 || parts[0] === 'tenants') {
			if (parts[1] === 'add') {
				return emptyRoute('tenant-add')
			}
			if (parts[1]) {
				const tenantId = parseId(parts[1])
				if (tenantId === null) {
					return emptyRoute('not-found')
				}
				if (parts[2] === 'edit') {
					return { ...emptyRoute('tenant-edit'), tenantId }
				}
				return { ...emptyRoute('tenant-detail'), tenantId }
			}
			return emptyRoute('tenants')
		}
		if (parts[0] === 'sites') {
			if (parts[1] === 'add') {
				return emptyRoute('site-add')
			}
			if (parts[1]) {
				const siteId = parseId(parts[1])
				if (siteId === null) {
					return emptyRoute('not-found')
				}
				if (parts[2] === 'edit') {
					return { ...emptyRoute('site-edit'), siteId }
				}
				return { ...emptyRoute('site-detail'), siteId }
			}
			return emptyRoute('sites')
		}
		if (parts[0] === 'site-groups') {
			if (parts[1] === 'add') {
				return emptyRoute('site-group-add')
			}
			if (parts[1]) {
				const siteGroupId = parseId(parts[1])
				if (siteGroupId === null) {
					return emptyRoute('not-found')
				}
				if (parts[2] === 'edit') {
					return { ...emptyRoute('site-group-edit'), siteGroupId }
				}
				return { ...emptyRoute('site-group-detail'), siteGroupId }
			}
			return emptyRoute('site-groups')
		}
		if (parts[0] === 'locations') {
			if (parts[1] === 'add') {
				return emptyRoute('location-add')
			}
			if (parts[1]) {
				const locationId = parseId(parts[1])
				if (locationId === null) {
					return emptyRoute('not-found')
				}
				if (parts[2] === 'edit') {
					return { ...emptyRoute('location-edit'), locationId }
				}
				return { ...emptyRoute('location-detail'), locationId }
			}
			return emptyRoute('locations')
		}
		if (parts[0] === 'racks') {
			if (parts[1] === 'add') {
				return emptyRoute('rack-add')
			}
			if (parts[1]) {
				const rackId = parseId(parts[1])
				if (rackId === null) {
					return emptyRoute('not-found')
				}
				if (parts[2] === 'edit') {
					return { ...emptyRoute('rack-edit'), rackId }
				}
				return { ...emptyRoute('rack-detail'), rackId }
			}
			return emptyRoute('racks')
		}
		if (parts[0] === 'rack-types' || parts[0] === 'templates') {
			if (parts[1] === 'add') {
				return emptyRoute('rack-type-add')
			}
			return emptyRoute('rack-types')
		}
		if (parts[0] === 'device-types') {
			if (parts[1] === 'add') {
				return emptyRoute('device-type-add')
			}
			if (parts[1] === 'import') {
				return emptyRoute('device-type-import')
			}
			if (parts[1]) {
				const deviceTypeId = parseId(parts[1])
				if (deviceTypeId === null) {
					return emptyRoute('not-found')
				}
				if (parts[2] === 'edit') {
					return { ...emptyRoute('device-type-edit'), deviceTypeId }
				}
				return { ...emptyRoute('device-type-detail'), deviceTypeId }
			}
			return emptyRoute('device-types')
		}
		if (parts[0] === 'manufacturers') {
			if (parts[1] === 'add') {
				return emptyRoute('manufacturer-add')
			}
			if (parts[1]) {
				const manufacturerId = parseId(parts[1])
				if (manufacturerId === null) {
					return emptyRoute('not-found')
				}
				if (parts[2] === 'edit') {
					return { ...emptyRoute('manufacturer-edit'), manufacturerId }
				}
				return { ...emptyRoute('manufacturer-detail'), manufacturerId }
			}
			return emptyRoute('manufacturers')
		}
		if (parts[0] === 'devices') {
			if (parts[1] === 'add') {
				return emptyRoute('device-add')
			}
			if (parts[1]) {
				const deviceId = parseId(parts[1])
				if (deviceId === null) {
					return emptyRoute('not-found')
				}
				if (parts[2] === 'edit') {
					return { ...emptyRoute('device-edit'), deviceId }
				}
				return { ...emptyRoute('device-detail'), deviceId }
			}
			return emptyRoute('devices')
		}
		if (parts[0] === 'interfaces') {
			return emptyRoute('interfaces')
		}
		if (parts[0] === 'connections' || parts[0] === 'cables') {
			return emptyRoute('connections')
		}
		if (parts[0] === 'topology') {
			return emptyRoute('topology')
		}
		if (parts[0] === 'users') {
			if (currentUser()?.role !== 'admin') {
				return emptyRoute('not-found')
			}
			if (parts[1] === 'add') {
				return emptyRoute('user-add')
			}
			if (parts[1]) {
				const userId = parseId(parts[1])
				if (userId === null) {
					return emptyRoute('not-found')
				}
				if (parts[2] === 'edit') {
					return { ...emptyRoute('user-edit'), userId }
				}
				return emptyRoute('not-found')
			}
			return emptyRoute('users')
		}
		return emptyRoute('not-found')
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
									<h1>Conex</h1>
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
								onClick={(e: MouseEvent): void => go(e, '/tenants')}
							>
								Conex
							</a>
							<div class="app-topbar-actions">
								<div class="app-user-menu">
									<button
										type="button"
										class="app-user-button"
										aria-haspopup="menu"
										aria-expanded={userMenuOpen()}
										aria-label={`Account: ${currentUser()?.username ?? '…'}`}
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
											aria-label="Account"
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
												Log out
											</button>
										</div>
									</Show>
								</div>
							</div>
						</header>
						<div class="app-body">
							<aside class="app-sidebar" aria-label="Primary">
								<p class="app-nav-label">Inventory</p>
								<nav class="app-nav">
									<NavItem
										href="/tenants"
										active={path().startsWith('/tenants') || path() === '/'}
										icon={<IconUsers size={16} />}
										label="Tenants"
										addHref="/tenants/add"
									/>
									<NavItem
										href="/site-groups"
										active={path().startsWith('/site-groups')}
										icon={<IconFolder size={16} />}
										label="Site Groups"
										addHref="/site-groups/add"
									/>
									<NavItem
										href="/sites"
										active={path().startsWith('/sites')}
										icon={<IconMapPin size={16} />}
										label="Sites"
										addHref="/sites/add"
									/>
									<NavItem
										href="/locations"
										active={path().startsWith('/locations')}
										icon={<IconLocation size={16} />}
										label="Locations"
										addHref="/locations/add"
									/>
									<NavItem
										href="/racks"
										active={path().startsWith('/racks')}
										icon={<IconBox size={16} />}
										label="Racks"
										addHref="/racks/add"
									/>
									<NavItem
										href="/rack-types"
										active={
											path().startsWith('/rack-types') ||
											path().startsWith('/templates')
										}
										icon={<IconTemplate size={16} />}
										label="Rack types"
										addHref="/rack-types/add"
									/>
									<NavItem
										href="/device-types"
										active={path().startsWith('/device-types')}
										icon={<IconCpu size={16} />}
										label="Device types"
										addHref="/device-types/add"
										importHref="/device-types/import"
									/>
									<NavItem
										href="/manufacturers"
										active={path().startsWith('/manufacturers')}
										icon={<IconBuildingFactory size={16} />}
										label="Manufacturers"
										addHref="/manufacturers/add"
									/>
									<NavItem
										href="/devices"
										active={path().startsWith('/devices')}
										icon={<IconServer size={16} />}
										label="Devices"
										addHref="/devices/add"
									/>
									<NavItem
										href="/interfaces"
										active={path().startsWith('/interfaces')}
										icon={<IconPlug size={16} />}
										label="Interfaces"
									/>
									<NavItem
										href="/connections"
										active={
											path().startsWith('/connections') ||
											path().startsWith('/cables')
										}
										icon={<IconLink size={16} />}
										label="Connections"
									/>
									<NavItem
										href="/topology"
										active={path().startsWith('/topology')}
										icon={<IconNetwork size={16} />}
										label="Topology"
									/>
									<Show when={currentUser()?.role === 'admin'}>
										<NavItem
											href="/users"
											active={path().startsWith('/users')}
											icon={<IconLock size={16} />}
											label="Users"
											addHref="/users/add"
										/>
									</Show>
								</nav>
							</aside>
							<main class="app-content" id="main">
								<Switch>
									<Match when={route().page === 'tenants'}>
										<TenantsPage />
									</Match>
									<Match when={route().page === 'tenant-add'}>
										<TenantAddPage />
									</Match>
									<Match
										when={
											route().page === 'tenant-detail' &&
											route().tenantId !== null
										}
									>
										<TenantDetailPage id={route().tenantId as number} />
									</Match>
									<Match
										when={
											route().page === 'tenant-edit' &&
											route().tenantId !== null
										}
									>
										<TenantEditPage id={route().tenantId as number} />
									</Match>
									<Match when={route().page === 'sites'}>
										<SitesPage />
									</Match>
									<Match when={route().page === 'site-add'}>
										<SiteAddPage />
									</Match>
									<Match
										when={
											route().page === 'site-detail' &&
											route().siteId !== null
										}
									>
										<SiteDetailPage id={route().siteId as number} />
									</Match>
									<Match
										when={
											route().page === 'site-edit' && route().siteId !== null
										}
									>
										<SiteEditPage id={route().siteId as number} />
									</Match>
									<Match when={route().page === 'locations'}>
										<LocationsPage />
									</Match>
									<Match when={route().page === 'location-add'}>
										<LocationAddPage />
									</Match>
									<Match
										when={
											route().page === 'location-detail' &&
											route().locationId !== null
										}
									>
										<LocationDetailPage id={route().locationId as number} />
									</Match>
									<Match
										when={
											route().page === 'location-edit' &&
											route().locationId !== null
										}
									>
										<LocationEditPage id={route().locationId as number} />
									</Match>
									<Match when={route().page === 'site-groups'}>
										<SiteGroupsPage />
									</Match>
									<Match when={route().page === 'site-group-add'}>
										<SiteGroupAddPage />
									</Match>
									<Match
										when={
											route().page === 'site-group-detail' &&
											route().siteGroupId !== null
										}
									>
										<SiteGroupDetailPage id={route().siteGroupId as number} />
									</Match>
									<Match
										when={
											route().page === 'site-group-edit' &&
											route().siteGroupId !== null
										}
									>
										<SiteGroupEditPage id={route().siteGroupId as number} />
									</Match>
									<Match when={route().page === 'racks'}>
										<RacksPage />
									</Match>
									<Match when={route().page === 'rack-add'}>
										<RackAddPage />
									</Match>
									<Match
										when={
											route().page === 'rack-detail' &&
											route().rackId !== null
										}
									>
										<RackDetailPage id={route().rackId as number} />
									</Match>
									<Match
										when={
											route().page === 'rack-edit' && route().rackId !== null
										}
									>
										<RackEditPage id={route().rackId as number} />
									</Match>
									<Match when={route().page === 'rack-types'}>
										<RackTypesPage />
									</Match>
									<Match when={route().page === 'rack-type-add'}>
										<RackTypeAddPage />
									</Match>
									<Match when={route().page === 'device-types'}>
										<DeviceTypesPage />
									</Match>
									<Match when={route().page === 'device-type-add'}>
										<DeviceTypeAddPage />
									</Match>
									<Match when={route().page === 'device-type-import'}>
										<DeviceTypeImportPage />
									</Match>
									<Match
										when={
											route().page === 'device-type-detail' &&
											route().deviceTypeId !== null
										}
									>
										<DeviceTypeDetailPage id={route().deviceTypeId as number} />
									</Match>
									<Match
										when={
											route().page === 'device-type-edit' &&
											route().deviceTypeId !== null
										}
									>
										<DeviceTypeEditPage id={route().deviceTypeId as number} />
									</Match>
									<Match when={route().page === 'manufacturers'}>
										<ManufacturersPage />
									</Match>
									<Match when={route().page === 'manufacturer-add'}>
										<ManufacturerAddPage />
									</Match>
									<Match
										when={
											route().page === 'manufacturer-detail' &&
											route().manufacturerId !== null
										}
									>
										<ManufacturerDetailPage
											id={route().manufacturerId as number}
										/>
									</Match>
									<Match
										when={
											route().page === 'manufacturer-edit' &&
											route().manufacturerId !== null
										}
									>
										<ManufacturerEditPage
											id={route().manufacturerId as number}
										/>
									</Match>
									<Match when={route().page === 'devices'}>
										<DevicesPage />
									</Match>
									<Match when={route().page === 'device-add'}>
										<DeviceAddPage />
									</Match>
									<Match
										when={
											route().page === 'device-detail' &&
											route().deviceId !== null
										}
									>
										<DeviceDetailPage id={route().deviceId as number} />
									</Match>
									<Match
										when={
											route().page === 'device-edit' &&
											route().deviceId !== null
										}
									>
										<DeviceEditPage id={route().deviceId as number} />
									</Match>
									<Match when={route().page === 'interfaces'}>
										<InterfacesPage />
									</Match>
									<Match when={route().page === 'connections'}>
										<ConnectionsPage />
									</Match>
									<Match when={route().page === 'topology'}>
										<TopologyPage />
									</Match>
									<Match when={route().page === 'users'}>
										<UsersPage />
									</Match>
									<Match when={route().page === 'user-add'}>
										<UserAddPage />
									</Match>
									<Match
										when={
											route().page === 'user-edit' && route().userId !== null
										}
									>
										<UserEditPage id={route().userId as number} />
									</Match>
									<Match when={route().page === 'not-found'}>
										<p>Not found.</p>
									</Match>
								</Switch>
							</main>
						</div>
					</Match>
				</Switch>
			</Show>
		</div>
	)
}

export default App
