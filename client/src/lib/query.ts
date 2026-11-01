/**
 * The TanStack Query cache behind `lib/resource.ts`. Writes have effects
 * across entities (deleting a site takes its racks along), so every
 * successful write outdates all data. Tabs stay mounted, but only the visible
 * one refetches right away; the others do when they are shown again.
 *
 * Staleness is tracked with a write counter: each fetch remembers the count
 * at its start, and data is current when no write finished after that.
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

/** Long enough for the caller to finish after its response (e.g. close a deleted object's tabs). */
const REFRESH_DELAY_MS = 50

let writes = 0
let pending: ReturnType<typeof setTimeout> | undefined
const [settledWrites, setSettledWrites] = createSignal(0)

/** Changes after a write, once the writes of one save have settled. */
export const writeSettled: Accessor<number> = settledWrites

/** Write count at the start of each query's latest fetch. */
const fetchedAt = new WeakMap<Query, number>()

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

/** False when a write finished after the latest fetch of `key` started. */
export function is_current(key: QueryKey): boolean {
	const query = find(key)
	const at = query && fetchedAt.get(query)
	return at === undefined || at >= writes
}

/** Outdates all data; the visible tab refreshes once the writes of a save have settled. */
export function invalidate_queries(): void {
	writes += 1
	clearTimeout(pending)
	pending = setTimeout(() => setSettledWrites(writes), REFRESH_DELAY_MS)
}

/** `fetch` for API calls: a successful request other than GET outdates the cache. */
export async function api_fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
	const res = await fetch(input, init)
	const method = init?.method?.toUpperCase() ?? 'GET'
	if (res.ok && method !== 'GET') {
		invalidate_queries()
	}
	return res
}
