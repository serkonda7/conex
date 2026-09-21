import { beforeAll, describe, expect, test } from 'bun:test'
import type { DeviceTraceResponse } from 'shared/src/schemas'
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
	devA: number
	devB: number
	a0: number
	a1: number
	b0: number
	b1: number
}

async function setupPair(prefix: string): Promise<Fixture> {
	const mfr = await api('POST', '/manufacturers', {
		name: `${prefix} Mfr`,
		slug: `${prefix}-mfr`,
	})
	expect(mfr.status).toBe(201)
	const type = await api('POST', '/device-types', {
		manufacturer_id: idOf(mfr),
		model: 'Switch 2',
		slug: `${prefix}-switch-2`,
		u_height: 1,
	})
	expect(type.status).toBe(201)
	expect(
		(
			await api('POST', `/device-types/${idOf(type)}/stubs`, {
				prefix: 'eth',
				count: 2,
				kind: 'ethernet',
			})
		).status,
	).toBe(201)
	async function mkDevice(name: string): Promise<number> {
		const dev = await api('POST', '/devices', {
			device_type_id: idOf(type),
			name,
		})
		expect(dev.status).toBe(201)
		return idOf(dev)
	}
	const devA = await mkDevice(`${prefix}-a`)
	const devB = await mkDevice(`${prefix}-b`)
	async function ifaceIds(dev: number): Promise<number[]> {
		const list = await api('GET', `/devices/${dev}/interfaces`)
		expect(list.status).toBe(200)
		return (list.body as { id: number; name: string }[]).map((r) => r.id)
	}
	const [a0, a1] = (await ifaceIds(devA)) as [number, number]
	const [b0, b1] = (await ifaceIds(devB)) as [number, number]
	return { devA, devB, a0: a0 as number, a1: a1 as number, b0: b0 as number, b1: b1 as number }
}

async function connectedOf(dev: number, iface: number): Promise<boolean> {
	const res = await api('GET', `/devices/${dev}/interfaces/${iface}`)
	expect(res.status).toBe(200)
	return (res.body as { connected: boolean }).connected
}

beforeAll(async () => {
	initTestEnv()
	createLocalUser('p5user', await Bun.password.hash('secret123'))
	const login = await api('POST', '/auth/login', {
		username: 'p5user',
		password: 'secret123',
	})
	expect(login.status).toBe(200)
	cookie = login.headers.get('set-cookie') ?? ''
	expect(cookie).toContain('auth_token=')
})

describe('auth guard', () => {
	test('cable endpoints require authentication', async () => {
		expect((await api('GET', '/cables', undefined, undefined, false)).status).toBe(401)
	})
})

describe('cables', () => {
	test('connect two free ports, both flags flip true', async () => {
		const f = await setupPair('p5-conn')
		const created = await api('POST', '/cables', {
			a_interface_id: f.a0,
			b_interface_id: f.b0,
			label: 'uplink-1',
		})
		expect(created.status).toBe(201)
		expect((created.body as { status: string }).status).toBe('connected')
		expect((created.body as { label: string }).label).toBe('uplink-1')
		expect(await connectedOf(f.devA, f.a0)).toBe(true)
		expect(await connectedOf(f.devB, f.b0)).toBe(true)
		expect(await connectedOf(f.devA, f.a1)).toBe(false)

		// Cable is readable and listed.
		expect((await api('GET', `/cables/${idOf(created)}`)).status).toBe(200)
		const listed = await api('GET', '/cables')
		expect((listed.body as { total: number }).total).toBeGreaterThanOrEqual(1)

		// Device delete is blocked while a cable touches it.
		expect((await api('DELETE', `/devices/${f.devA}`)).status).toBe(409)

		expect((await api('DELETE', `/cables/${idOf(created)}`)).status).toBe(200)
		expect((await api('DELETE', `/devices/${f.devA}`)).status).toBe(200)
		expect((await api('DELETE', `/devices/${f.devB}`)).status).toBe(200)
	})

	test('double-connect rejected: a busy, b busy, same interface', async () => {
		const f = await setupPair('p5-dbl')
		const first = await api('POST', '/cables', {
			a_interface_id: f.a0,
			b_interface_id: f.b0,
		})
		expect(first.status).toBe(201)

		// a busy (a0 reused with a free b1).
		expect(
			(await api('POST', '/cables', { a_interface_id: f.a0, b_interface_id: f.b1 })).status,
		).toBe(409)
		// b busy (free a1 reused with b0).
		expect(
			(await api('POST', '/cables', { a_interface_id: f.a1, b_interface_id: f.b0 })).status,
		).toBe(409)
		// Same interface twice.
		expect(
			(await api('POST', '/cables', { a_interface_id: f.a1, b_interface_id: f.a1 })).status,
		).toBe(409)
		// Missing endpoint 404s.
		expect(
			(await api('POST', '/cables', { a_interface_id: f.a1, b_interface_id: 99999 })).status,
		).toBe(404)

		expect((await api('DELETE', `/cables/${idOf(first)}`)).status).toBe(200)
		expect((await api('DELETE', `/devices/${f.devA}`)).status).toBe(200)
		expect((await api('DELETE', `/devices/${f.devB}`)).status).toBe(200)
	})

	test('delete frees both ports; convenience connect + trace correct', async () => {
		const f = await setupPair('p5-trace')
		// Convenience: one end in the path, peer in the body.
		const via = await api('POST', `/devices/${f.devA}/interfaces/${f.a1}/connect`, {
			peer_interface_id: f.b1,
		})
		expect(via.status).toBe(201)
		const cableId = idOf(via)

		const traceA = await api('GET', `/devices/${f.devA}/trace`)
		expect(traceA.status).toBe(200)
		const linksA = (traceA.body as DeviceTraceResponse).links
		expect(linksA).toHaveLength(1)
		expect(linksA[0]?.local_interface.name).toBe('eth1')
		expect(linksA[0]?.peer_interface.name).toBe('eth1')
		expect(linksA[0]?.peer_device.id).toBe(f.devB)

		const traceB = await api('GET', `/devices/${f.devB}/trace`)
		expect(traceB.status).toBe(200)
		const linksB = (traceB.body as DeviceTraceResponse).links
		expect(linksB).toHaveLength(1)
		expect(linksB[0]?.peer_device.id).toBe(f.devA)

		// Metadata-only patch; endpoints immutable (unknown key rejected).
		const patched = await api('PATCH', `/cables/${cableId}`, { label: 'core-link' })
		expect(patched.status).toBe(200)
		expect((patched.body as { label: string }).label).toBe('core-link')
		expect((await api('PATCH', `/cables/${cableId}`, { a_interface_id: f.a0 })).status).toBe(
			400,
		)

		// Cable list filters.
		const byDevice = await api('GET', '/cables', undefined, `?device=${f.devA}`)
		expect((byDevice.body as { total: number }).total).toBe(1)
		const byIface = await api('GET', '/cables', undefined, `?interface=${f.b1}`)
		expect((byIface.body as { total: number }).total).toBe(1)

		expect((await api('DELETE', `/cables/${cableId}`)).status).toBe(200)
		expect(await connectedOf(f.devA, f.a1)).toBe(false)
		expect(await connectedOf(f.devB, f.b1)).toBe(false)
		expect(
			((await api('GET', `/devices/${f.devA}/trace`)).body as DeviceTraceResponse).links,
		).toHaveLength(0)

		// Reconnect after delete works (ports really freed).
		expect(
			(await api('POST', '/cables', { a_interface_id: f.a1, b_interface_id: f.b1 })).status,
		).toBe(201)
		const again = await api('GET', '/cables', undefined, `?device=${f.devA}`)
		const againId = ((again.body as { items: { id: number }[] }).items[0] as { id: number }).id
		expect((await api('DELETE', `/cables/${againId}`)).status).toBe(200)

		expect((await api('DELETE', `/devices/${f.devA}`)).status).toBe(200)
		expect((await api('DELETE', `/devices/${f.devB}`)).status).toBe(200)
	})

	test('trace of unknown device 404s; unknown cable 404s', async () => {
		expect((await api('GET', '/devices/99999/trace')).status).toBe(404)
		expect((await api('GET', '/cables/99999')).status).toBe(404)
		expect((await api('DELETE', '/cables/99999')).status).toBe(404)
	})
})
