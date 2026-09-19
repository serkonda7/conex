import { beforeAll, describe, expect, test } from 'bun:test'
import type { ElevationResponse } from 'shared/src/schemas'
import { createLocalUser } from './db/users'
import { createApp } from './index'
import { initTestEnv } from './test_setup'

const app = createApp()
let cookie = ''

async function api(
	method: string,
	path: string,
	body?: unknown,
	query?: string,
	useAuth = true,
): Promise<{ status: number; body: unknown; headers: Headers }> {
	const headers: Record<string, string> = {}
	if (useAuth) {
		headers.cookie = cookie
	}
	if (body !== undefined) {
		headers['content-type'] = 'application/json'
	}
	const res = await app.request(`${path}${query ?? ''}`, {
		method,
		headers,
		body: body === undefined ? undefined : JSON.stringify(body),
	})
	let parsed: unknown = null
	try {
		parsed = await res.json()
	} catch {
		parsed = null
	}
	return { status: res.status, body: parsed, headers: res.headers }
}

function idOf(res: { body: unknown }): number {
	return (res.body as { id: number }).id
}

beforeAll(async () => {
	initTestEnv()
	createLocalUser('p2@example.com', await Bun.password.hash('secret123'))
	const login = await api('POST', '/auth/login', {
		email: 'p2@example.com',
		password: 'secret123',
	})
	expect(login.status).toBe(200)
	cookie = login.headers.get('set-cookie') ?? ''
	expect(cookie).toContain('auth_token=')
})

describe('auth guard', () => {
	test('P2 endpoints require authentication', async () => {
		for (const path of ['/racks', '/shelves']) {
			const res = await api('GET', path, undefined, undefined, false)
			expect(res.status).toBe(401)
		}
		const rackless = await api('GET', '/racks/nope/elevation', undefined, undefined, false)
		expect(rackless.status).toBe(401)
	})
})

describe('racks', () => {
	test('full CRUD with defaults', async () => {
		const site = await api('POST', '/sites', { name: 'P2 DC', slug: 'p2-dc' })
		expect(site.status).toBe(201)
		const siteId = idOf(site)

		const created = await api('POST', '/racks', {
			name: 'Rack A1',
			slug: 'rack-a1',
			site_id: siteId,
		})
		expect(created.status).toBe(201)
		const rack = created.body as { height_u: number; status: string }
		expect(rack.height_u).toBe(42)
		expect(rack.status).toBe('active')
		const id = idOf(created)

		const dup = await api('POST', '/racks', {
			name: 'Rack A1 copy',
			slug: 'rack-a1',
			site_id: siteId,
		})
		expect(dup.status).toBe(409)

		const missingSite = await api('POST', '/racks', {
			name: 'Ghost',
			slug: 'ghost-rack',
			site_id: 99999,
		})
		expect(missingSite.status).toBe(404)

		const badHeight = await api('POST', '/racks', {
			name: 'Tall',
			slug: 'tall-rack',
			site_id: siteId,
			height_u: 61,
		})
		expect(badHeight.status).toBe(400)

		const listed = await api('GET', '/racks', undefined, `?site=${siteId}`)
		expect(listed.status).toBe(200)
		expect((listed.body as { total: number }).total).toBe(1)

		const updated = await api('PATCH', `/racks/${id}`, { status: 'staged', height_u: 45 })
		expect(updated.status).toBe(200)
		expect((updated.body as { status: string }).status).toBe('staged')

		const badStatus = await api('PATCH', `/racks/${id}`, { status: 'melting' })
		expect(badStatus.status).toBe(400)

		expect((await api('DELETE', `/racks/${id}`)).status).toBe(200)
		expect((await api('GET', `/racks/${id}`)).status).toBe(404)
		expect((await api('DELETE', `/sites/${siteId}`)).status).toBe(200)
	})

	test('location must belong to the rack site', async () => {
		const s1 = await api('POST', '/sites', { name: 'P2 S1', slug: 'p2-s1' })
		const s2 = await api('POST', '/sites', { name: 'P2 S2', slug: 'p2-s2' })
		const loc = await api('POST', '/locations', {
			name: 'Room',
			slug: 'p2-room',
			site_id: idOf(s2),
		})
		const crossSite = await api('POST', '/racks', {
			name: 'Cross',
			slug: 'p2-cross',
			site_id: idOf(s1),
			location_id: idOf(loc),
		})
		expect(crossSite.status).toBe(404)

		const ok = await api('POST', '/racks', {
			name: 'Local',
			slug: 'p2-local',
			site_id: idOf(s2),
			location_id: idOf(loc),
		})
		expect(ok.status).toBe(201)

		// Location delete blocked while the rack links it; site blocked by both.
		expect((await api('DELETE', `/locations/${idOf(loc)}`)).status).toBe(409)
		expect((await api('DELETE', `/sites/${idOf(s2)}`)).status).toBe(409)
		expect((await api('DELETE', `/racks/${idOf(ok)}`)).status).toBe(200)
		expect((await api('DELETE', `/locations/${idOf(loc)}`)).status).toBe(200)
		expect((await api('DELETE', `/sites/${idOf(s1)}`)).status).toBe(200)
		expect((await api('DELETE', `/sites/${idOf(s2)}`)).status).toBe(200)
	})

	test('filters by site, location, and tenant', async () => {
		const tenant = await api('POST', '/tenants', { name: 'P2 T', slug: 'p2-t' })
		const site = await api('POST', '/sites', { name: 'P2 FS', slug: 'p2-fs' })
		const loc = await api('POST', '/locations', {
			name: 'Row',
			slug: 'p2-row',
			site_id: idOf(site),
		})
		const rack = await api('POST', '/racks', {
			name: 'Filtered',
			slug: 'p2-filtered',
			site_id: idOf(site),
			location_id: idOf(loc),
			tenant_id: idOf(tenant),
		})
		expect(rack.status).toBe(201)

		const byTenant = await api('GET', '/racks', undefined, `?tenant=${idOf(tenant)}`)
		expect((byTenant.body as { total: number }).total).toBe(1)
		const byLocation = await api('GET', '/racks', undefined, `?location=${idOf(loc)}`)
		expect((byLocation.body as { total: number }).total).toBe(1)
		const byOther = await api('GET', '/racks', undefined, '?tenant=99999')
		expect((byOther.body as { total: number }).total).toBe(0)

		expect((await api('DELETE', `/racks/${idOf(rack)}`)).status).toBe(200)
		expect((await api('DELETE', `/locations/${idOf(loc)}`)).status).toBe(200)
		expect((await api('DELETE', `/sites/${idOf(site)}`)).status).toBe(200)
		expect((await api('DELETE', `/tenants/${idOf(tenant)}`)).status).toBe(200)
	})
})

describe('shelves', () => {
	test('bounds and overlap validation', async () => {
		const site = await api('POST', '/sites', { name: 'P2 Shelf', slug: 'p2-shelf' })
		const rack = await api('POST', '/racks', {
			name: 'Shelf rack',
			slug: 'p2-shelf-rack',
			site_id: idOf(site),
		})
		const rackId = idOf(rack)

		const shelf = await api('POST', '/shelves', {
			name: 'Tray',
			rack_id: rackId,
			position_u: 10,
			height_u: 1,
		})
		expect(shelf.status).toBe(201)
		const shelfId = idOf(shelf)

		const overlap = await api('POST', '/shelves', {
			name: 'Clash',
			rack_id: rackId,
			position_u: 10,
			height_u: 1,
		})
		expect(overlap.status).toBe(409)

		const spanning = await api('POST', '/shelves', {
			name: 'Spanning',
			rack_id: rackId,
			position_u: 9,
			height_u: 2,
		})
		expect(spanning.status).toBe(409)

		const outOfBounds = await api('POST', '/shelves', {
			name: 'High',
			rack_id: rackId,
			position_u: 42,
			height_u: 2,
		})
		expect(outOfBounds.status).toBe(409)

		const missingRack = await api('POST', '/shelves', {
			name: 'Ghost',
			rack_id: 99999,
			position_u: 1,
		})
		expect(missingRack.status).toBe(404)

		// Move onto itself is fine; move into another shelf is rejected.
		const other = await api('POST', '/shelves', {
			name: 'Other',
			rack_id: rackId,
			position_u: 20,
		})
		expect(other.status).toBe(201)
		expect((await api('PATCH', `/shelves/${idOf(other)}`, { position_u: 10 })).status).toBe(409)
		expect((await api('PATCH', `/shelves/${idOf(other)}`, { position_u: 21 })).status).toBe(200)

		// Rack delete blocked while shelves exist; shrink blocked below top shelf.
		expect((await api('DELETE', `/racks/${rackId}`)).status).toBe(409)
		expect((await api('PATCH', `/racks/${rackId}`, { height_u: 20 })).status).toBe(409)
		expect((await api('PATCH', `/racks/${rackId}`, { height_u: 30 })).status).toBe(200)

		// Shelves list by rack filter.
		const listed = await api('GET', '/shelves', undefined, `?rack=${rackId}`)
		expect((listed.body as { total: number }).total).toBe(2)

		expect((await api('DELETE', `/shelves/${shelfId}`)).status).toBe(200)
		expect((await api('DELETE', `/shelves/${idOf(other)}`)).status).toBe(200)
		expect((await api('DELETE', `/racks/${rackId}`)).status).toBe(200)
		expect((await api('DELETE', `/sites/${idOf(site)}`)).status).toBe(200)
	})
})

describe('elevation', () => {
	test('top-down U map with the shelf as a spanning block', async () => {
		const site = await api('POST', '/sites', { name: 'P2 Elev', slug: 'p2-elev' })
		const rack = await api('POST', '/racks', {
			name: 'Elev rack',
			slug: 'p2-elev-rack',
			site_id: idOf(site),
			height_u: 5,
		})
		const rackId = idOf(rack)
		const shelf = await api('POST', '/shelves', {
			name: 'Mid tray',
			rack_id: rackId,
			position_u: 2,
			height_u: 2,
		})
		expect(shelf.status).toBe(201)

		const res = await api('GET', `/racks/${rackId}/elevation`)
		expect(res.status).toBe(200)
		const elevation = res.body as ElevationResponse
		expect(elevation.rack_id).toBe(rackId)
		expect(elevation.height_u).toBe(5)
		expect(elevation.units.map((u) => u.u)).toEqual([5, 4, 3, 2, 1])
		for (const unit of elevation.units) {
			if (unit.u === 2 || unit.u === 3) {
				expect(unit.shelf?.name).toBe('Mid tray')
			} else {
				expect(unit.shelf).toBeNull()
			}
			expect(unit.device).toBeNull()
		}

		expect((await api('GET', '/racks/99999/elevation')).status).toBe(404)

		expect((await api('DELETE', `/shelves/${idOf(shelf)}`)).status).toBe(200)
		expect((await api('DELETE', `/racks/${rackId}`)).status).toBe(200)
		expect((await api('DELETE', `/sites/${idOf(site)}`)).status).toBe(200)
	})

	test('empty rack elevation is all free', async () => {
		const site = await api('POST', '/sites', { name: 'P2 Empty', slug: 'p2-empty' })
		const rack = await api('POST', '/racks', {
			name: 'Empty rack',
			slug: 'p2-empty-rack',
			site_id: idOf(site),
		})
		const res = await api('GET', `/racks/${idOf(rack)}/elevation`)
		expect(res.status).toBe(200)
		const elevation = res.body as ElevationResponse
		expect(elevation.units).toHaveLength(42)
		expect(elevation.units.every((u) => u.shelf === null && u.device === null)).toBe(true)

		expect((await api('DELETE', `/racks/${idOf(rack)}`)).status).toBe(200)
		expect((await api('DELETE', `/sites/${idOf(site)}`)).status).toBe(200)
	})
})
