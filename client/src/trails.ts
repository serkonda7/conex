/**
 * Ancestor trails for the breadcrumb bar. Best effort: a failed lookup just
 * shortens the trail, since the page itself reports load errors.
 */
import { Result } from 'better-result'
import { fetch_locations, fetch_site_group } from './api_tenancy'
import type { Crumb } from './router'

/** Guards the parent walks against cycles in bad data. */
const MAX_DEPTH = 32

/** The site group `id` and its ancestors, outermost first. */
export async function siteGroupTrail(id: number | null): Promise<Crumb[]> {
	const trail: Crumb[] = []
	const seen = new Set<number>()
	let next = id
	while (next !== null && !seen.has(next) && seen.size < MAX_DEPTH) {
		seen.add(next)
		const res = await fetch_site_group(next)
		if (Result.isError(res)) {
			break
		}
		trail.unshift({ label: res.value.name, href: `/site-groups/${res.value.id}` })
		next = res.value.parent_id
	}
	return trail
}

/** The location `id` and its ancestors within the site, outermost first. */
export async function locationTrail(siteId: number, id: number | null): Promise<Crumb[]> {
	if (id === null) {
		return []
	}
	const res = await fetch_locations(siteId)
	if (Result.isError(res)) {
		return []
	}
	const byId = new Map(res.value.items.map((l) => [l.id, l]))
	const trail: Crumb[] = []
	let next = byId.get(id)
	while (next && trail.length < MAX_DEPTH) {
		trail.unshift({ label: next.name, href: `/locations/${next.id}` })
		next = next.parent_id !== null ? byId.get(next.parent_id) : undefined
	}
	return trail
}
