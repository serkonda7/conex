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
	IconX,
} from '@tabler/icons-solidjs'
import { Result } from 'better-result'
import type { InputEventAndTarget } from 'shared/src/types'
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
import {
	activateTab,
	activeTabId,
	closeTab,
	goTo,
	isDetailRoute,
	openInNewTab,
	parseId,
	path,
	setTabLabel,
	type TabState,
	tabLabel,
	tabPathContext,
	tabs,
} from './router'

const APP_TITLE = 'CoNetBox'

function go(e: MouseEvent, to: string): void {
	goTo(e, to)
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
				Benutzername
			</label>
			<input
				id="login-username"
				type="text"
				placeholder="Benutzername"
				aria-label="Benutzername"
				required
				value={props.username()}
				onInput={(e: InputEventAndTarget) => props.setUsername(e.currentTarget.value)}
				autocomplete="username"
			/>
			<label class="visually-hidden" for="login-password">
				Passwort
			</label>
			<input
				id="login-password"
				type="password"
				placeholder="Passwort"
				aria-label="Passwort"
				required
				value={props.password()}
				onInput={(e: InputEventAndTarget) => props.setPassword(e.currentTarget.value)}
				autocomplete="current-password"
			/>
			<button type="submit">Anmelden</button>
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
		<section aria-label="Ersteinrichtung">
			<h2>Willkommen bei Conex</h2>
			<p class="page-subtitle">Erstellen Sie ein Administratorkonto, um zu beginnen.</p>
			<form onSubmit={props.onSetup}>
				<label class="visually-hidden" for="setup-username">
					Administrator-Benutzername
				</label>
				<input
					id="setup-username"
					type="text"
					placeholder="Administrator-Benutzername"
					aria-label="Administrator-Benutzername"
					required
					value={props.username()}
					onInput={(e: InputEventAndTarget) => props.setUsername(e.currentTarget.value)}
					autocomplete="username"
				/>
				<label class="visually-hidden" for="setup-password">
					Passwort
				</label>
				<input
					id="setup-password"
					type="password"
					placeholder="Passwort"
					aria-label="Passwort"
					required
					value={props.password()}
					onInput={(e: InputEventAndTarget) => props.setPassword(e.currentTarget.value)}
					autocomplete="new-password"
				/>
				<label class="visually-hidden" for="setup-confirm">
					Passwort bestätigen
				</label>
				<input
					id="setup-confirm"
					type="password"
					placeholder="Passwort bestätigen"
					aria-label="Passwort bestätigen"
					required
					value={props.confirm()}
					onInput={(e: InputEventAndTarget) => props.setConfirm(e.currentTarget.value)}
					autocomplete="new-password"
				/>
				<button type="submit">Administratorkonto erstellen</button>
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
					aria-label={`${props.label} hinzufügen`}
					title={`${props.label} hinzufügen`}
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
					aria-label={`${props.label} hinzufügen (demnächst verfügbar)`}
					title={`${props.label} hinzufügen (demnächst verfügbar)`}
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
					aria-label={`${props.label} importieren`}
					title={`${props.label} importieren`}
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

interface RouteInfo {
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
}

function emptyRoute(page: string): RouteInfo {
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

/** Pure route parser so every background tab can resolve its own path. */
function parseRoute(routePath: string, isAdmin: boolean): RouteInfo {
	const parts =
		routePath
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
		if (!isAdmin) {
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

/**
 * In-app tab strip: each entry keeps its page mounted in the background so
 * opening an add/edit form never discards the list/detail behind it.
 */
function TabBar(): JSX.Element {
	const TabContext = tabPathContext()
	return (
		<div class="tab-bar" role="tablist" aria-label="Geöffnete Seiten">
			<For each={tabs()}>
				{(tab: TabState) => (
					<div
						role="tab"
						aria-selected={tab.id === activeTabId()}
						aria-label={tabLabel(tab.id, tab.path)}
						title={tab.path}
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
					>
						<TabContext.Provider value={tab.path}>
							<span class="tab-title">{tabLabel(tab.id, tab.path)}</span>
						</TabContext.Provider>
						<Show when={tabs().length > 1}>
							<button
								type="button"
								class="tab-close"
								aria-label={`${tabLabel(tab.id, tab.path)} schließen`}
								title={`${tabLabel(tab.id, tab.path)} schließen`}
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
	)
}

/** Page content for one tab; `routePath` is that tab's own path. */
function RouteContent(props: { routePath: string; tabId: number; isAdmin: boolean }): JSX.Element {
	const TabContext = tabPathContext()
	const info = (): RouteInfo => parseRoute(props.routePath, props.isAdmin)
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
	onMount(() => {
		if (!isDetailRoute(props.routePath)) {
			return
		}
		const pageRoot = document.querySelector<HTMLElement>(`[data-tab-id="${props.tabId}"]`)
		if (!pageRoot) {
			return
		}
		const updateLabel = (): void => {
			const heading = pageRoot.querySelector('h2')
			const label = heading
				? Array.from(heading.childNodes)
						.map((node) => node.textContent?.trim() ?? '')
						.find((text) => text.length > 0) || heading.textContent?.trim()
				: undefined
			if (label) {
				setTabLabel(props.tabId, label)
			}
		}
		const observer = new MutationObserver(updateLabel)
		observer.observe(pageRoot, { childList: true, subtree: true, characterData: true })
		updateLabel()
		onCleanup(() => observer.disconnect())
	})
	return (
		<TabContext.Provider value={props.routePath}>
			<Switch>
				<Match when={info().page === 'tenants'}>
					<TenantsPage />
				</Match>
				<Match when={info().page === 'tenant-add'}>
					<TenantAddPage />
				</Match>
				<Match when={info().page === 'tenant-detail' && info().tenantId !== null}>
					<TenantDetailPage id={info().tenantId as number} />
				</Match>
				<Match when={info().page === 'tenant-edit' && info().tenantId !== null}>
					<TenantEditPage id={info().tenantId as number} />
				</Match>
				<Match when={info().page === 'sites'}>
					<SitesPage />
				</Match>
				<Match when={info().page === 'site-add'}>
					<SiteAddPage />
				</Match>
				<Match when={info().page === 'site-detail' && info().siteId !== null}>
					<SiteDetailPage id={info().siteId as number} />
				</Match>
				<Match when={info().page === 'site-edit' && info().siteId !== null}>
					<SiteEditPage id={info().siteId as number} />
				</Match>
				<Match when={info().page === 'locations'}>
					<LocationsPage />
				</Match>
				<Match when={info().page === 'location-add'}>
					<LocationAddPage />
				</Match>
				<Match when={info().page === 'location-detail' && info().locationId !== null}>
					<LocationDetailPage id={info().locationId as number} />
				</Match>
				<Match when={info().page === 'location-edit' && info().locationId !== null}>
					<LocationEditPage id={info().locationId as number} />
				</Match>
				<Match when={info().page === 'site-groups'}>
					<SiteGroupsPage />
				</Match>
				<Match when={info().page === 'site-group-add'}>
					<SiteGroupAddPage />
				</Match>
				<Match when={info().page === 'site-group-detail' && info().siteGroupId !== null}>
					<SiteGroupDetailPage id={info().siteGroupId as number} />
				</Match>
				<Match when={info().page === 'site-group-edit' && info().siteGroupId !== null}>
					<SiteGroupEditPage id={info().siteGroupId as number} />
				</Match>
				<Match when={info().page === 'racks'}>
					<RacksPage />
				</Match>
				<Match when={info().page === 'rack-add'}>
					<RackAddPage />
				</Match>
				<Match when={info().page === 'rack-detail' && info().rackId !== null}>
					<RackDetailPage id={info().rackId as number} />
				</Match>
				<Match when={info().page === 'rack-edit' && info().rackId !== null}>
					<RackEditPage id={info().rackId as number} />
				</Match>
				<Match when={info().page === 'rack-types'}>
					<RackTypesPage />
				</Match>
				<Match when={info().page === 'rack-type-add'}>
					<RackTypeAddPage />
				</Match>
				<Match when={info().page === 'device-types'}>
					<DeviceTypesPage />
				</Match>
				<Match when={info().page === 'device-type-add'}>
					<DeviceTypeAddPage />
				</Match>
				<Match when={info().page === 'device-type-import'}>
					<DeviceTypeImportPage />
				</Match>
				<Match when={info().page === 'device-type-detail' && info().deviceTypeId !== null}>
					<DeviceTypeDetailPage id={info().deviceTypeId as number} />
				</Match>
				<Match when={info().page === 'device-type-edit' && info().deviceTypeId !== null}>
					<DeviceTypeEditPage id={info().deviceTypeId as number} />
				</Match>
				<Match when={info().page === 'manufacturers'}>
					<ManufacturersPage />
				</Match>
				<Match when={info().page === 'manufacturer-add'}>
					<ManufacturerAddPage />
				</Match>
				<Match
					when={info().page === 'manufacturer-detail' && info().manufacturerId !== null}
				>
					<ManufacturerDetailPage id={info().manufacturerId as number} />
				</Match>
				<Match when={info().page === 'manufacturer-edit' && info().manufacturerId !== null}>
					<ManufacturerEditPage id={info().manufacturerId as number} />
				</Match>
				<Match when={info().page === 'devices'}>
					<DevicesPage />
				</Match>
				<Match when={info().page === 'device-add'}>
					<DeviceAddPage />
				</Match>
				<Match when={info().page === 'device-detail' && info().deviceId !== null}>
					<DeviceDetailPage id={info().deviceId as number} />
				</Match>
				<Match when={info().page === 'device-edit' && info().deviceId !== null}>
					<DeviceEditPage id={info().deviceId as number} />
				</Match>
				<Match when={info().page === 'interfaces'}>
					<InterfacesPage />
				</Match>
				<Match when={info().page === 'connections'}>
					<ConnectionsPage />
				</Match>
				<Match when={info().page === 'topology'}>
					<TopologyPage />
				</Match>
				<Match when={info().page === 'users'}>
					<UsersPage />
				</Match>
				<Match when={info().page === 'user-add'}>
					<UserAddPage />
				</Match>
				<Match when={info().page === 'user-edit' && info().userId !== null}>
					<UserEditPage id={info().userId as number} />
				</Match>
				<Match when={info().page === 'not-found'}>
					<p>Seite nicht gefunden.</p>
				</Match>
			</Switch>
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
		// Smart tabs: Ctrl/Cmd/Shift-click or middle-click on any in-app link
		// opens it in a new tab instead of replacing the current page.
		const onLinkClick = (e: MouseEvent): void => {
			if (!(e.target instanceof Element)) {
				return
			}
			const anchor = e.target.closest('a[href]')
			if (!anchor || !(anchor instanceof HTMLAnchorElement)) {
				return
			}
			const href = anchor.getAttribute('href') ?? ''
			if (!href.startsWith('/') || href.startsWith('//')) {
				return
			}
			if (e.ctrlKey || e.metaKey || e.shiftKey) {
				e.preventDefault()
				openInNewTab(href)
			}
		}
		const onAuxClick = (e: MouseEvent): void => {
			if (e.button !== 1 || !(e.target instanceof Element)) {
				return
			}
			const anchor = e.target.closest('a[href]')
			if (!anchor || !(anchor instanceof HTMLAnchorElement)) {
				return
			}
			const href = anchor.getAttribute('href') ?? ''
			if (!href.startsWith('/') || href.startsWith('//')) {
				return
			}
			e.preventDefault()
			openInNewTab(href)
		}
		document.addEventListener('click', onDocClick)
		document.addEventListener('click', onLinkClick)
		document.addEventListener('auxclick', onAuxClick)
		onCleanup(() => {
			document.removeEventListener('click', onDocClick)
			document.removeEventListener('click', onLinkClick)
			document.removeEventListener('auxclick', onAuxClick)
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
			setSetupError('Benutzername ist erforderlich.')
			return
		}
		if (!setupPassword()) {
			setSetupError('Passwort ist erforderlich.')
			return
		}
		if (setupPassword() !== setupConfirm()) {
			setSetupError('Die Passwörter stimmen nicht überein.')
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
				Zum Inhalt springen
			</a>
			<Show
				when={isLoggedIn() !== null && needsSetup() !== null}
				fallback={
					<main class="app-content">
						<p class="skeleton">Wird geladen…</p>
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
								onClick={(e: MouseEvent): void => go(e, '/tenants')}
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
										aria-label={`Konto: ${currentUser()?.username ?? '…'}`}
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
											aria-label="Konto"
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
												Abmelden
											</button>
										</div>
									</Show>
								</div>
							</div>
						</header>
						<div class="app-body">
							<aside class="app-sidebar" aria-label="Hauptnavigation">
								<p class="app-nav-label">Inventar</p>
								<nav class="app-nav">
									<NavItem
										href="/tenants"
										active={path().startsWith('/tenants') || path() === '/'}
										icon={<IconUsers size={16} />}
										label="Mandanten"
										addHref="/tenants/add"
									/>
									<NavItem
										href="/site-groups"
										active={path().startsWith('/site-groups')}
										icon={<IconFolder size={16} />}
										label="Standortgruppen"
										addHref="/site-groups/add"
									/>
									<NavItem
										href="/sites"
										active={path().startsWith('/sites')}
										icon={<IconMapPin size={16} />}
										label="Standorte"
										addHref="/sites/add"
									/>
									<NavItem
										href="/locations"
										active={path().startsWith('/locations')}
										icon={<IconLocation size={16} />}
										label="Bereiche"
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
										label="Racktypen"
										addHref="/rack-types/add"
									/>
									<NavItem
										href="/device-types"
										active={path().startsWith('/device-types')}
										icon={<IconCpu size={16} />}
										label="Gerätetypen"
										addHref="/device-types/add"
										importHref="/device-types/import"
									/>
									<NavItem
										href="/manufacturers"
										active={path().startsWith('/manufacturers')}
										icon={<IconBuildingFactory size={16} />}
										label="Hersteller"
										addHref="/manufacturers/add"
									/>
									<NavItem
										href="/devices"
										active={path().startsWith('/devices')}
										icon={<IconServer size={16} />}
										label="Geräte"
										addHref="/devices/add"
									/>
									<NavItem
										href="/interfaces"
										active={path().startsWith('/interfaces')}
										icon={<IconPlug size={16} />}
										label="Anschlüsse"
									/>
									<NavItem
										href="/connections"
										active={
											path().startsWith('/connections') ||
											path().startsWith('/cables')
										}
										icon={<IconLink size={16} />}
										label="Verbindungen"
									/>
									<NavItem
										href="/topology"
										active={path().startsWith('/topology')}
										icon={<IconNetwork size={16} />}
										label="Topologie"
									/>
									<Show when={currentUser()?.role === 'admin'}>
										<NavItem
											href="/users"
											active={path().startsWith('/users')}
											icon={<IconLock size={16} />}
											label="Benutzer"
											addHref="/users/add"
										/>
									</Show>
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
