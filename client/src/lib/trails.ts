/**
 * Ancestor trails for the breadcrumb bar. Best effort: a failed lookup just
 * shortens the trail, since the page itself reports load errors.
 */
import { Result } from 'better-result'
import { fetch_locations, fetch_site_group } from '../api/tenancy'
import type { Crumb } from './router'

/** Guards the parent walks against cycles in bad data. */
const MAX_DEPTH = 32

/** The site group `id` as a single crumb (site groups are flat). */
export async function siteGroupTrail(id: number | null): Promise<Crumb[]> {
	if (id === null) {
		return []
	}
	const res = await fetch_site_group(id)
	if (Result.isError(res)) {
		return []
	}
	return [{ label: res.value.name, href: `/site-groups/${res.value.id}` }]
}

/** The location `id` and its ancestors within the site, outermost first. */
export async function locationTrail(siteId: number, id: number | null): Promise<Crumb[]> {
	if (id === null) {
		return []
	}
	const res = await fetch_locations({ site: siteId })
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

/** The site as a crumb, then the location `id` and its ancestors. */
export async function siteTrail(
	site: { id: number; name: string } | null | undefined,
	locationId: number | null,
): Promise<Crumb[]> {
	if (!site) {
		return []
	}
	const locations = await locationTrail(site.id, locationId)
	return [{ label: site.name, href: `/sites/${site.id}` }, ...locations]
}
