/**
 * The TanStack Query cache behind `lib/resource.ts`. A successful write
 * outdates the data it can affect: each query is tagged with the API
 * resources its fetch requested (`/api/<resource>/…`), and `READS` /
 * `WRITES` below say which tags a write to a resource reaches. Writes to a
 * resource missing from the map, and `invalidate_queries()` without a
 * resource, outdate everything. Tabs stay mounted, but only the visible one
 * refetches right away; the others do when they are shown again.
 *
 * Staleness is tracked with a write counter: each fetch remembers the count
 * at its start, and data is current when no write that reaches one of its
 * tags finished after that.
 */
import { type Query, QueryClient, type QueryKey } from '@tanstack/solid-query'
import { type Accessor, createSignal } from 'solid-js'

export const queryClient = new QueryClient({
	defaultOptions: {
		queries: {
			// Always stale: a mounting page shows cached rows and refreshes them.
			staleTime: 0,
			retry: false,
			refetchOnWindowFocus: false,
			refetchOnReconnect: false,
			networkMode: 'always',
		},
	},
})

/** Reaches every query: any write outdates it, or it outdates every query. */
const ALL = '*'

type Reach = readonly string[] | typeof ALL

/** Tenant names (sorting, labels) and tenant or tenant-group scope filters. */
const TENANCY = ['tenants', 'tenant-groups'] as const

/** Every inventory and catalog resource, for responses that join most of them. */
const INVENTORY = [
	...TENANCY,
	'sites',
	'site-groups',
	'locations',
	'racks',
	'shelves',
	'devices',
	'virtual-machines',
	'interfaces',
	'cables',
	'employees',
	'manufacturers',
	'rack-types',
	'device-types',
	'device-roles',
	'priorities',
	'service-levels',
	'managed-bundles',
	'attachments',
] as const

/**
 * Data in the responses of each resource besides its own rows: joined
 * names, counts, sort or filter columns. A query tagged with a resource
 * missing here is outdated by every write.
 */
const READS: Record<string, Reach> = {
	// Tenant counts.
	'tenant-groups': ['tenants'],
	// Group name, site/rack/device counts, bundle and service-level names of contracts.
	tenants: ['tenant-groups', 'sites', 'racks', 'devices', 'managed-bundles', 'service-levels'],
	// Tenant and group sorting, tenant scope.
	sites: [...TENANCY, 'site-groups'],
	'site-groups': [...TENANCY, 'sites'],
	// Site and tenant names; outlets list device ports with their cable peers.
	locations: [...TENANCY, 'sites', 'devices', 'interfaces', 'cables'],
	// Site/location/type names; the elevation shows devices with type heights and roles, and shelves.
	racks: [
		...TENANCY,
		'sites',
		'locations',
		'rack-types',
		'manufacturers',
		'shelves',
		'devices',
		'device-types',
		'device-roles',
	],
	// Tenant scope goes through the rack.
	shelves: [...TENANCY, 'racks'],
	// Device-type, rack-type, device and past-EOL counts.
	manufacturers: ['device-types', 'rack-types', 'devices'],
	// Manufacturer name, rack count.
	'rack-types': ['manufacturers', 'racks'],
	// Manufacturer and role names, device counts; the update preview diffs the
	// ports of built devices with their cables and floor-plan positions.
	'device-types': [
		'manufacturers',
		'device-roles',
		'devices',
		'interfaces',
		'cables',
		'attachments',
	],
	// Bundle name, device/VM/device-type counts.
	'device-roles': ['managed-bundles', 'devices', 'virtual-machines', 'device-types'],
	priorities: ['service-levels'],
	// Target priorities.
	'service-levels': ['priorities'],
	// Role and tenant counts.
	'managed-bundles': ['device-roles', 'tenants'],
	// List rows, ports, cables, traces, jacks, services, template sync: nearly everything.
	devices: INVENTORY,
	// Host, role, tenant and employee names; the service goes through role, bundle and tenant.
	'virtual-machines': [
		...TENANCY,
		'devices',
		'device-roles',
		'employees',
		'managed-bundles',
		'service-levels',
		'priorities',
	],
	// Device names and tenant scope, connected flags, outlet locations.
	interfaces: [...TENANCY, 'devices', 'cables', 'locations'],
	// End ports and devices, traces, tenant scope of both ends.
	cables: [...TENANCY, 'interfaces', 'devices'],
	// Tenant memberships, the linked login.
	employees: [...TENANCY, 'users'],
	// Role, employee and tenant names.
	users: [...TENANCY, 'roles', 'employees'],
	// User counts.
	roles: ['users'],
	// Owners, floor plans with their placed racks, devices, ports and jacks, outlets.
	attachments: [...INVENTORY, 'users'],
	'saved-filters': [],
	'saved-layouts': [],
	// Technician mappings use the TANSS connection.
	'calendar-sync': ['integrations', 'employees'],
	// Contacts matched with local employees and logins.
	directory: [...TENANCY, 'employees', 'users', 'integrations'],
	// Nearly every write appends to the logs; search, links and sync reports span everything.
	changelog: ALL,
	'audit-log': ALL,
	search: ALL,
	integrations: ALL,
}

/**
 * What a write to each resource changes besides its own rows. A write to a
 * resource missing here outdates everything.
 */
const WRITES: Record<string, Reach> = {
	// Deleting one drops its integration links.
	tenants: ['integrations'],
	'tenant-groups': [],
	// Attachments and floor-plan areas go with a deleted site.
	sites: ['attachments'],
	'site-groups': [],
	// Attachments go with a deleted location; moving one prunes floor-plan placements.
	locations: ['attachments'],
	// Attachments go with a deleted rack; moving one prunes floor-plan placements.
	racks: ['attachments'],
	// Deleting one releases its devices.
	shelves: ['devices'],
	manufacturers: [],
	'rack-types': [],
	// Type updates, stubs and imports resync the ports of built devices: ports
	// and floor-plan placements go, cables move along.
	'device-types': ['devices', 'interfaces', 'cables', 'attachments'],
	'device-roles': [],
	priorities: [],
	'service-levels': [],
	'managed-bundles': [],
	// Hosted VMs follow the tenant; ports, jacks and cables are written through
	// device routes; deletes cascade to placements and integration links.
	devices: ['virtual-machines', 'interfaces', 'cables', 'attachments', 'integrations'],
	'virtual-machines': [],
	// Connecting and disconnecting flips the connected flags of ports.
	cables: ['interfaces'],
	// Deactivating or deleting one changes its login; deletes drop integration links.
	employees: ['users', 'integrations'],
	// Placing outlets on a plan sets their location.
	attachments: ['interfaces'],
	'saved-filters': [],
	'saved-layouts': [],
	'calendar-sync': [],
	// Sign-in, users and roles change the session's permissions and tenant scope.
	auth: ALL,
	users: ALL,
	roles: ALL,
	// Links, imports and syncs create and change local records of many kinds.
	integrations: ALL,
}

const reachCache = new Map<string, ReadonlySet<string> | typeof ALL>()

/** Tags of the queries a write to `resource` outdates. */
function reach_of(resource: string): ReadonlySet<string> | typeof ALL {
	const known = reachCache.get(resource)
	if (known !== undefined) {
		return known
	}
	const effects = WRITES[resource]
	let reach: ReadonlySet<string> | typeof ALL = ALL
	if (effects !== undefined && effects !== ALL) {
		const changed = new Set([resource, ...effects])
		const tags = new Set<string>()
		for (const [tag, reads] of Object.entries(READS)) {
			if (reads !== ALL && (changed.has(tag) || reads.some((dep) => changed.has(dep)))) {
				tags.add(tag)
			}
		}
		reach = tags
	}
	reachCache.set(resource, reach)
	return reach
}

/** The resource of an API URL (`/api/devices/3` → `devices`); `ALL` for others. */
function resource_of(input: RequestInfo | URL): string {
	const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
	return /^(?:[a-z][a-z\d+.-]*:\/\/[^/]+)?\/api\/([^/?#]+)/i.exec(url)?.[1] ?? ALL
}

/** Long enough for the caller to finish after its response (e.g. close a deleted object's tabs). */
const REFRESH_DELAY_MS = 50

let writes = 0
/** Count of the latest write that outdated everything. */
let allAt = 0
/** Count of the latest write that reached each tag. */
const tagAt = new Map<string, number>()
let pending: ReturnType<typeof setTimeout> | undefined
const [settledWrites, setSettledWrites] = createSignal(0)

/** Changes after a write, once the writes of one save have settled. */
export const writeSettled: Accessor<number> = settledWrites

/** Write count at the start of each query's latest fetch. */
const fetchedAt = new WeakMap<Query, number>()
/** Resources requested by each query's latest fetch. */
const tagsOf = new WeakMap<Query, Set<string>>()

/** Tags of the fetch whose load function runs synchronously right now. */
let collecting: Set<string> | null = null
/** Tags of the fetches still running. */
const running = new Set<Set<string>>()

/**
 * Tags a GET with the fetch that issued it. Requests made synchronously by a
 * load function are attributed exactly; later ones (after an `await` in the
 * loader) cannot be told apart, so every running fetch gets them.
 */
function record_read(resource: string): void {
	if (collecting) {
		collecting.add(resource)
		return
	}
	for (const tags of running) {
		tags.add(resource)
	}
}

/** Count of the latest write that outdates data with these tags. */
function outdated_at(tags: ReadonlySet<string> | undefined): number {
	if (!tags || tags.size === 0) {
		return writes
	}
	let at = allAt
	for (const tag of tags) {
		const reads = READS[tag]
		const tagged = reads === undefined || reads === ALL ? writes : (tagAt.get(tag) ?? 0)
		at = Math.max(at, tagged)
	}
	return at
}

function find(key: QueryKey): Query | undefined {
	return queryClient.getQueryCache().find({ queryKey: key, exact: true })
}

/** Records that a fetch of `key` starts now. */
export function mark_fetch(key: QueryKey): void {
	const query = find(key)
	if (query) {
		fetchedAt.set(query, writes)
	}
}

/** Runs the load function of a fetch of `key`, tagging the query with the resources it requests. */
export function track_fetch<T>(key: QueryKey, load: () => Promise<T>): Promise<T> {
	mark_fetch(key)
	const tags = new Set<string>()
	const query = find(key)
	if (query) {
		tagsOf.set(query, tags)
	}
	running.add(tags)
	const outer = collecting
	collecting = tags
	let result: Promise<T> | undefined
	try {
		result = load()
	} finally {
		collecting = outer
		if (result === undefined) {
			running.delete(tags)
		}
	}
	return result.finally(() => running.delete(tags))
}

/** False when a write reaching the data of `key` finished after its latest fetch started. */
export function is_current(key: QueryKey): boolean {
	const query = find(key)
	const at = query && fetchedAt.get(query)
	return at === undefined || at >= outdated_at(query && tagsOf.get(query))
}

/**
 * Outdates the data a write to `resource` can affect, or all data without
 * one; the visible tab refreshes once the writes of a save have settled.
 */
export function invalidate_queries(resource?: string): void {
	writes += 1
	const reach = resource === undefined ? ALL : reach_of(resource)
	if (reach === ALL) {
		allAt = writes
	} else {
		for (const tag of reach) {
			tagAt.set(tag, writes)
		}
	}
	clearTimeout(pending)
	pending = setTimeout(() => setSettledWrites(writes), REFRESH_DELAY_MS)
}

/** `fetch` for API calls: a GET tags the running fetch, a successful other request outdates the cache. */
export async function api_fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
	const method = init?.method?.toUpperCase() ?? 'GET'
	const resource = resource_of(input)
	if (method === 'GET') {
		record_read(resource)
	}
	const res = await fetch(input, init)
	if (res.ok && method !== 'GET') {
		invalidate_queries(resource)
	}
	return res
}
