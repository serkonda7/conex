import { beforeAll, describe, expect, test } from 'bun:test'
import type { ImportResponse } from 'shared/src/schemas'
import type { GlobalSearchResponse } from './db/search'
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

async function apiText(path: string): Promise<{ status: number; text: string; headers: Headers }> {
	const res = await app.request(path, { method: 'GET', headers: { cookie } })
	return { status: res.status, text: await res.text(), headers: res.headers }
}

function idOf(res: { body: unknown }): string {
	return (res.body as { id: string }).id
}

beforeAll(async () => {
	initTestEnv()
	createLocalUser('p6@example.com', await Bun.password.hash('secret123'))
	const login = await api('POST', '/auth/login', {
		email: 'p6@example.com',
		password: 'secret123',
	})
	expect(login.status).toBe(200)
	cookie = login.headers.get('set-cookie') ?? ''
	expect(cookie).toContain('auth_token=')
})

describe('auth guard', () => {
	test('search and CSV endpoints require authentication', async () => {
		expect((await api('GET', '/search', undefined, '?q=x', false)).status).toBe(401)
		expect((await api('GET', '/devices/export', undefined, undefined, false)).status).toBe(401)
	})
})

describe('global search', () => {
	test('finds tenants, sites, devices, and cables in groups', async () => {
		const tenant = await api('POST', '/tenants', {
			name: 'P6 Search Tenant',
			slug: 'p6-search-tenant',
		})
		expect(tenant.status).toBe(201)
		const site = await api('POST', '/sites', { name: 'P6 Search Site', slug: 'p6-search-site' })
		expect(site.status).toBe(201)

		const mfr = await api('POST', '/manufacturers', {
			name: 'P6 Search Mfr',
			slug: 'p6-search-mfr',
		})
		expect(mfr.status).toBe(201)
		const type = await api('POST', '/device-types', {
			manufacturer_id: idOf(mfr),
			model: 'Search Box',
			slug: 'p6-search-box',
			u_height: 1,
		})
		expect(type.status).toBe(201)
		expect(
			(await api('POST', `/device-types/${idOf(type)}/stubs`, { prefix: 'eth', count: 2 }))
				.status,
		).toBe(201)
		const devA = await api('POST', '/devices', {
			device_type_id: idOf(type),
			name: 'p6-search-a',
			asset_tag: 'P6-SEARCH-A',
		})
		expect(devA.status).toBe(201)
		const devB = await api('POST', '/devices', {
			device_type_id: idOf(type),
			name: 'p6-search-b',
		})
		expect(devB.status).toBe(201)
		const ifaces = (await api('GET', `/devices/${idOf(devA)}/interfaces`)).body as {
			id: string
		}[]
		const peer = (await api('GET', `/devices/${idOf(devB)}/interfaces`)).body as {
			id: string
		}[]
		const cable = await api('POST', '/cables', {
			// biome-ignore lint/style/noNonNullAssertion: test fixture guarantees two stub ports
			a_interface_id: ifaces[0]!.id,
			// biome-ignore lint/style/noNonNullAssertion: test fixture guarantees two stub ports
			b_interface_id: peer[0]!.id,
			label: 'p6-search-link',
		})
		expect(cable.status).toBe(201)

		const res = await api('GET', '/search', undefined, '?q=p6-search')
		expect(res.status).toBe(200)
		const found = res.body as GlobalSearchResponse
		expect(found.tenants.items.length).toBeGreaterThanOrEqual(1)
		expect(found.sites.items.length).toBeGreaterThanOrEqual(1)
		expect(found.devices.items.length).toBeGreaterThanOrEqual(2)
		expect(found.cables.items.length).toBeGreaterThanOrEqual(1)

		const empty = await api('GET', '/search', undefined, '?q=')
		expect(empty.status).toBe(200)
		expect((empty.body as GlobalSearchResponse).devices.items).toHaveLength(0)
	})
})

describe('CSV transfer', () => {
	test('device export header + import round-trip with per-row errors', async () => {
		const mfr = await api('POST', '/manufacturers', { name: 'P6 CSV Mfr', slug: 'p6-csv-mfr' })
		expect(mfr.status).toBe(201)
		const type = await api('POST', '/device-types', {
			manufacturer_id: idOf(mfr),
			model: 'CSV Box',
			slug: 'p6-csv-box',
			u_height: 1,
		})
		expect(type.status).toBe(201)
		expect(
			(await api('POST', `/device-types/${idOf(type)}/stubs`, { prefix: 'eth', count: 2 }))
				.status,
		).toBe(201)

		const exported = await apiText('/devices/export')
		expect(exported.status).toBe(200)
		expect(exported.headers.get('content-type')).toContain('text/csv')
		expect(exported.text.split('\n')[0]).toBe(
			'name,asset_tag,device_type_slug,site_slug,rack_slug,position_u,status',
		)

		const csv = [
			'name,asset_tag,device_type_slug,site_slug,rack_slug,position_u,status',
			'p6-csv-a,TAG-A,p6-csv-box,,,,active',
			'p6-csv-b,,p6-csv-box,,,,active',
			'p6-csv-bad,,missing-type,,,,active',
		].join('\n')
		const imported = await api('POST', '/devices/import', { csv })
		expect(imported.status).toBe(201)
		const result = imported.body as ImportResponse
		expect(result.created).toBe(2)
		expect(result.failed).toBe(1)
		expect(result.rows[2]?.error).toContain('missing-type')
	})

	test('cable export header + import round-trip', async () => {
		const exported = await apiText('/cables/export')
		expect(exported.status).toBe(200)
		expect(exported.text.split('\n')[0]).toBe(
			'a_device,a_interface,b_device,b_interface,label,kind,status',
		)

		const csv = [
			'a_device,a_interface,b_device,b_interface,label,kind,status',
			'p6-csv-a,eth1,p6-csv-b,eth1,p6-csv-link,cat6,connected',
			'p6-csv-a,eth1,p6-csv-b,eth0,dupe-link,,connected',
		].join('\n')
		const imported = await api('POST', '/cables/import', { csv })
		expect(imported.status).toBe(201)
		const result = imported.body as ImportResponse
		expect(result.created).toBe(1)
		expect(result.failed).toBe(1)
	})

	test('empty CSV body rejected', async () => {
		expect((await api('POST', '/devices/import', { csv: '' })).status).toBe(400)
	})
})
