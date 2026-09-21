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

interface Fixture {
	siteId: number
	rackId: number
	shelfId: number
	typeId: number
	virtualTypeId: number
	bigTypeId: number
	tenantId: number
}

/** Rack (42U, shelf at U10) + 1U switch template (eth x24) + 0U virtual template. */
async function setupFixture(prefix: string): Promise<Fixture> {
	const tenant = await api('POST', '/tenants', { name: `${prefix} T`, slug: `${prefix}-t` })
	expect(tenant.status).toBe(201)
	const site = await api('POST', '/sites', { name: `${prefix} DC`, slug: `${prefix}-dc` })
	expect(site.status).toBe(201)
	const rack = await api('POST', '/racks', {
		name: `${prefix} Rack`,
		slug: `${prefix}-rack`,
		site_id: idOf(site),
	})
	expect(rack.status).toBe(201)
	const shelf = await api('POST', '/shelves', {
		name: `${prefix} Tray`,
		rack_id: idOf(rack),
		position_u: 10,
	})
	expect(shelf.status).toBe(201)
	const mfr = await api('POST', '/manufacturers', {
		name: `${prefix} Mfr`,
		slug: `${prefix}-mfr`,
	})
	expect(mfr.status).toBe(201)
	const type = await api('POST', '/device-types', {
		manufacturer_id: idOf(mfr),
		model: 'Switch 24',
		slug: `${prefix}-switch-24`,
		u_height: 1,
	})
	expect(type.status).toBe(201)
	const stub = await api('POST', `/device-types/${idOf(type)}/stubs`, {
		prefix: 'eth',
		count: 24,
		kind: 'ethernet',
	})
	expect(stub.status).toBe(201)
	const virtual = await api('POST', '/device-types', {
		manufacturer_id: idOf(mfr),
		model: 'Virtual',
		slug: `${prefix}-virtual`,
		u_height: 0,
	})
	expect(virtual.status).toBe(201)
	const big = await api('POST', '/device-types', {
		manufacturer_id: idOf(mfr),
		model: 'Chassis',
		slug: `${prefix}-chassis`,
		u_height: 4,
	})
	expect(big.status).toBe(201)
	return {
		siteId: idOf(site),
		rackId: idOf(rack),
		shelfId: idOf(shelf),
		typeId: idOf(type),
		virtualTypeId: idOf(virtual),
		bigTypeId: idOf(big),
		tenantId: idOf(tenant),
	}
}

beforeAll(async () => {
	initTestEnv()
	createLocalUser('p4user', await Bun.password.hash('secret123'))
	const login = await api('POST', '/auth/login', {
		username: 'p4user',
		password: 'secret123',
	})
	expect(login.status).toBe(200)
	cookie = login.headers.get('set-cookie') ?? ''
	expect(cookie).toContain('auth_token=')
})

describe('auth guard', () => {
	test('device endpoints require authentication', async () => {
		const res = await api('GET', '/devices', undefined, undefined, false)
		expect(res.status).toBe(401)
	})
})

describe('device create', () => {
	test('transactional create expands template stubs into interfaces', async () => {
		const f = await setupFixture('p4-create')
		const created = await api('POST', '/devices', {
			device_type_id: f.typeId,
			name: 'sw01',
			site_id: f.siteId,
			rack_id: f.rackId,
			position_u: 1,
		})
		expect(created.status).toBe(201)
		const deviceId = idOf(created)
		expect((created.body as { status: string }).status).toBe('active')

		const ifaces = await api('GET', `/devices/${deviceId}/interfaces`)
		expect(ifaces.status).toBe(200)
		const rows = ifaces.body as { name: string; kind: string; connected: boolean }[]
		expect(rows).toHaveLength(24)
		expect(rows[0]?.name).toBe('eth0')
		expect(rows[23]?.name).toBe('eth23')
		expect(rows.every((r) => r.kind === 'ethernet' && r.connected === false)).toBe(true)

		// Elevation shows the device at U1; the shelf still shows at U10.
		const elev = await api('GET', `/racks/${f.rackId}/elevation`)
		expect(elev.status).toBe(200)
		const units = (elev.body as ElevationResponse).units
		expect(units.find((u) => u.u === 1)?.device?.name).toBe('sw01')
		expect(units.find((u) => u.u === 10)?.shelf?.name).toContain('Tray')

		expect((await api('DELETE', `/devices/${deviceId}`)).status).toBe(200)
		// Delete cascades interfaces: the device (and its ports) are gone.
		expect((await api('GET', `/devices/${deviceId}/interfaces`)).status).toBe(404)
	})

	test('mount XOR: position and shelf together are rejected', async () => {
		const f = await setupFixture('p4-xor')
		const both = await api('POST', '/devices', {
			device_type_id: f.typeId,
			name: 'both',
			rack_id: f.rackId,
			position_u: 2,
			shelf_id: f.shelfId,
		})
		expect(both.status).toBe(409)

		// Unracked devices leave rack/position/shelf all empty.
		const free = await api('POST', '/devices', {
			device_type_id: f.typeId,
			name: 'spare',
		})
		expect(free.status).toBe(201)
		const spare = free.body as { rack_id: unknown; position_u: unknown; shelf_id: unknown }
		expect(spare.rack_id).toBeNull()
		expect(spare.position_u).toBeNull()
		expect(spare.shelf_id).toBeNull()

		// Unracked device with a position is rejected.
		const stray = await api('POST', '/devices', {
			device_type_id: f.typeId,
			name: 'stray',
			position_u: 3,
		})
		expect(stray.status).toBe(409)

		// Racked device with neither position nor shelf is rejected.
		const nowhere = await api('POST', '/devices', {
			device_type_id: f.typeId,
			name: 'nowhere',
			rack_id: f.rackId,
		})
		expect(nowhere.status).toBe(409)

		expect((await api('DELETE', `/devices/${idOf(free)}`)).status).toBe(200)
	})

	test('U overlap with shelves and devices is rejected', async () => {
		const f = await setupFixture('p4-overlap')
		// Shelf sits at U10: a 1U device there collides with the shelf.
		expect(
			(
				await api('POST', '/devices', {
					device_type_id: f.typeId,
					name: 'on-shelf-u',
					rack_id: f.rackId,
					position_u: 10,
				})
			).status,
		).toBe(409)

		const first = await api('POST', '/devices', {
			device_type_id: f.typeId,
			name: 'first',
			rack_id: f.rackId,
			position_u: 1,
		})
		expect(first.status).toBe(201)

		// Same U collides with the device.
		expect(
			(
				await api('POST', '/devices', {
					device_type_id: f.typeId,
					name: 'clash',
					rack_id: f.rackId,
					position_u: 1,
				})
			).status,
		).toBe(409)

		// 4U chassis at U1..U4 collides with the 1U device at U1.
		expect(
			(
				await api('POST', '/devices', {
					device_type_id: f.bigTypeId,
					name: 'chassis',
					rack_id: f.rackId,
					position_u: 1,
				})
			).status,
		).toBe(409)

		// Out of bounds: U42 + 4U sticks out of the 42U rack.
		expect(
			(
				await api('POST', '/devices', {
					device_type_id: f.bigTypeId,
					name: 'tall',
					rack_id: f.rackId,
					position_u: 42,
				})
			).status,
		).toBe(409)

		// Shelf creation collides with the device at U1.
		expect(
			(
				await api('POST', '/shelves', {
					name: 'clash-tray',
					rack_id: f.rackId,
					position_u: 1,
				})
			).status,
		).toBe(409)

		expect((await api('DELETE', `/devices/${idOf(first)}`)).status).toBe(200)
	})

	test('shelf placement consumes 0 U for any template height', async () => {
		const f = await setupFixture('p4-shelf')
		// 0U virtual device on the shelf.
		const virt = await api('POST', '/devices', {
			device_type_id: f.virtualTypeId,
			name: 'vm01',
			rack_id: f.rackId,
			shelf_id: f.shelfId,
		})
		expect(virt.status).toBe(201)

		// 1U switch on the same shelf: shelf-sitters consume 0 U each.
		const boxed = await api('POST', '/devices', {
			device_type_id: f.typeId,
			name: 'boxed',
			rack_id: f.rackId,
			shelf_id: f.shelfId,
		})
		expect(boxed.status).toBe(201)

		// 0U template at a rack position is rejected (nothing to occupy).
		expect(
			(
				await api('POST', '/devices', {
					device_type_id: f.virtualTypeId,
					name: 'floating',
					rack_id: f.rackId,
					position_u: 5,
				})
			).status,
		).toBe(409)

		// Shelf must sit in the same rack.
		const other = await api('POST', '/racks', {
			name: 'Other',
			slug: 'p4-shelf-other',
			site_id: f.siteId,
		})
		expect(other.status).toBe(201)
		expect(
			(
				await api('POST', '/devices', {
					device_type_id: f.typeId,
					name: 'cross-rack',
					rack_id: idOf(other),
					shelf_id: f.shelfId,
				})
			).status,
		).toBe(404)

		expect((await api('DELETE', `/devices/${idOf(virt)}`)).status).toBe(200)
		expect((await api('DELETE', `/devices/${idOf(boxed)}`)).status).toBe(200)
		expect((await api('DELETE', `/racks/${idOf(other)}`)).status).toBe(200)
	})

	test('asset_tag unique; unknown device type 404s', async () => {
		const f = await setupFixture('p4-tag')
		const first = await api('POST', '/devices', {
			device_type_id: f.typeId,
			name: 'tagged',
			asset_tag: 'ASSET-1',
		})
		expect(first.status).toBe(201)

		expect(
			(
				await api('POST', '/devices', {
					device_type_id: f.typeId,
					name: 'tagged-copy',
					asset_tag: 'ASSET-1',
				})
			).status,
		).toBe(409)

		expect(
			(
				await api('POST', '/devices', {
					device_type_id: 99999,
					name: 'ghost',
				})
			).status,
		).toBe(404)

		expect((await api('DELETE', `/devices/${idOf(first)}`)).status).toBe(200)
	})
})

describe('device move and update', () => {
	test('move re-validates U and shelf', async () => {
		const f = await setupFixture('p4-move')
		const a = await api('POST', '/devices', {
			device_type_id: f.typeId,
			name: 'mover',
			rack_id: f.rackId,
			position_u: 1,
		})
		expect(a.status).toBe(201)
		const aId = idOf(a)
		const b = await api('POST', '/devices', {
			device_type_id: f.typeId,
			name: 'blocker',
			rack_id: f.rackId,
			position_u: 5,
		})
		expect(b.status).toBe(201)

		// Move into the occupied U5 is rejected.
		expect((await api('POST', `/devices/${aId}/move`, { position_u: 5 })).status).toBe(409)
		// Move onto the shelf U10 succeeds (0 U consumed). The old rack
		// position is cleared explicitly: `undefined` would keep it and trip
		// the position/shelf XOR.
		expect(
			(await api('POST', `/devices/${aId}/move`, { shelf_id: f.shelfId, position_u: null }))
				.status,
		).toBe(200)
		// Move carries both position and shelf: XOR rejects.
		expect(
			(await api('POST', `/devices/${aId}/move`, { position_u: 2, shelf_id: f.shelfId }))
				.status,
		).toBe(409)
		// Back to a free U position.
		const moved = await api('POST', `/devices/${aId}/move`, {
			position_u: 2,
			shelf_id: null,
		})
		expect(moved.status).toBe(200)
		expect((moved.body as { position_u: number }).position_u).toBe(2)
		expect((moved.body as { shelf_id: unknown }).shelf_id).toBeNull()
		// Unrack entirely.
		const unracked = await api('POST', `/devices/${aId}/move`, {
			rack_id: null,
			position_u: null,
		})
		expect(unracked.status).toBe(200)
		expect((unracked.body as { rack_id: unknown }).rack_id).toBeNull()
		// Empty move body fails validation.
		expect((await api('POST', `/devices/${aId}/move`, {})).status).toBe(400)

		expect((await api('DELETE', `/devices/${aId}`)).status).toBe(200)
		expect((await api('DELETE', `/devices/${idOf(b)}`)).status).toBe(200)
	})

	test('filters by site, rack, tenant, and status', async () => {
		const f = await setupFixture('p4-filter')
		const dev = await api('POST', '/devices', {
			device_type_id: f.typeId,
			name: 'filtered-sw',
			site_id: f.siteId,
			rack_id: f.rackId,
			position_u: 20,
			tenant_id: f.tenantId,
			status: 'staged',
		})
		expect(dev.status).toBe(201)
		const devId = idOf(dev)

		const byRack = await api('GET', '/devices', undefined, `?rack=${f.rackId}`)
		expect((byRack.body as { total: number }).total).toBe(1)
		const bySite = await api('GET', '/devices', undefined, `?site=${f.siteId}`)
		expect((bySite.body as { total: number }).total).toBe(1)
		const byTenant = await api('GET', '/devices', undefined, `?tenant=${f.tenantId}`)
		expect((byTenant.body as { total: number }).total).toBe(1)
		const byStatus = await api('GET', '/devices', undefined, '?status=staged')
		expect((byStatus.body as { total: number }).total).toBe(1)
		const byOther = await api('GET', '/devices', undefined, `?status=active&rack=${f.rackId}`)
		expect((byOther.body as { total: number }).total).toBe(0)
		const bySearch = await api('GET', '/devices', undefined, '?search=filtered-sw')
		expect((bySearch.body as { total: number }).total).toBe(1)

		expect((await api('DELETE', `/devices/${devId}`)).status).toBe(200)
	})
})

describe('interfaces', () => {
	test('manual add and edit with per-device name uniqueness', async () => {
		const f = await setupFixture('p4-iface')
		const dev = await api('POST', '/devices', {
			device_type_id: f.virtualTypeId,
			name: 'portless',
		})
		expect(dev.status).toBe(201)
		const devId = idOf(dev)

		// Virtual template has no stubs: interface list starts empty.
		expect((await api('GET', `/devices/${devId}/interfaces`)).body as unknown[]).toHaveLength(0)

		const added = await api('POST', `/devices/${devId}/interfaces`, {
			name: 'mgmt0',
			kind: 'ethernet',
		})
		expect(added.status).toBe(201)
		const ifaceId = idOf(added)

		// Duplicate name on the same device is rejected.
		expect((await api('POST', `/devices/${devId}/interfaces`, { name: 'mgmt0' })).status).toBe(
			409,
		)

		// Same name on another device is fine.
		const other = await api('POST', '/devices', {
			device_type_id: f.virtualTypeId,
			name: 'portless-2',
		})
		expect(other.status).toBe(201)
		expect(
			(await api('POST', `/devices/${idOf(other)}/interfaces`, { name: 'mgmt0' })).status,
		).toBe(201)

		// Edit rename + kind.
		const edited = await api('PATCH', `/devices/${devId}/interfaces/${ifaceId}`, {
			name: 'mgmt1',
			kind: 'fiber',
		})
		expect(edited.status).toBe(200)
		expect((edited.body as { name: string }).name).toBe('mgmt1')
		expect((edited.body as { kind: string }).kind).toBe('fiber')

		// Read back one interface.
		const single = await api('GET', `/devices/${devId}/interfaces/${ifaceId}`)
		expect(single.status).toBe(200)
		expect((single.body as { name: string }).name).toBe('mgmt1')

		// Cross-device interface id is not visible here.
		expect((await api('GET', `/devices/${idOf(other)}/interfaces/${ifaceId}`)).status).toBe(404)

		expect((await api('DELETE', `/devices/${devId}`)).status).toBe(200)
		expect((await api('DELETE', `/devices/${idOf(other)}`)).status).toBe(200)
	})
})

describe('delete blocks', () => {
	test('rack, shelf, and device-type deletes are blocked by devices', async () => {
		const f = await setupFixture('p4-block')
		const dev = await api('POST', '/devices', {
			device_type_id: f.typeId,
			name: 'blocker',
			rack_id: f.rackId,
			shelf_id: f.shelfId,
		})
		expect(dev.status).toBe(201)
		const devId = idOf(dev)

		expect((await api('DELETE', `/racks/${f.rackId}`)).status).toBe(409)
		expect((await api('DELETE', `/shelves/${f.shelfId}`)).status).toBe(409)
		expect((await api('DELETE', `/device-types/${f.typeId}`)).status).toBe(409)

		expect((await api('DELETE', `/devices/${devId}`)).status).toBe(200)
		expect((await api('DELETE', `/device-types/${f.typeId}`)).status).toBe(200)
	})
})
