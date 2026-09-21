import { beforeAll, describe, expect, test } from 'bun:test'
import type { StubPreviewResponse } from 'shared/src/schemas'
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
	createLocalUser('p3user', await Bun.password.hash('secret123'))
	const login = await api('POST', '/auth/login', {
		username: 'p3user',
		password: 'secret123',
	})
	expect(login.status).toBe(200)
	cookie = login.headers.get('set-cookie') ?? ''
	expect(cookie).toContain('auth_token=')
})

describe('auth guard', () => {
	test('P3 endpoints require authentication', async () => {
		for (const path of ['/manufacturers', '/device-types']) {
			const res = await api('GET', path, undefined, undefined, false)
			expect(res.status).toBe(401)
		}
		const preview = await api('GET', '/device-types/preview', undefined, '?prefix=eth&count=2')
		expect(preview.status).toBe(200)
		const anon = await api(
			'GET',
			'/device-types/preview',
			undefined,
			'?prefix=eth&count=2',
			false,
		)
		expect(anon.status).toBe(401)
	})
})

describe('manufacturers', () => {
	test('full CRUD with unique name and slug', async () => {
		const created = await api('POST', '/manufacturers', {
			name: 'Acme Networks',
			slug: 'acme',
		})
		expect(created.status).toBe(201)
		const id = idOf(created)

		const dupSlug = await api('POST', '/manufacturers', { name: 'Other', slug: 'acme' })
		expect(dupSlug.status).toBe(409)
		const dupName = await api('POST', '/manufacturers', {
			name: 'Acme Networks',
			slug: 'acme-2',
		})
		expect(dupName.status).toBe(409)

		const listed = await api('GET', '/manufacturers', undefined, '?search=acme')
		expect(listed.status).toBe(200)
		expect((listed.body as { total: number }).total).toBe(1)

		const updated = await api('PATCH', `/manufacturers/${id}`, { description: 'Top vendor' })
		expect(updated.status).toBe(200)
		expect((updated.body as { description: string }).description).toBe('Top vendor')

		expect((await api('DELETE', `/manufacturers/${id}`)).status).toBe(200)
		expect((await api('GET', `/manufacturers/${id}`)).status).toBe(404)
	})

	test('delete blocked while device types exist', async () => {
		const mfr = await api('POST', '/manufacturers', { name: 'P3 Block', slug: 'p3-block' })
		const type = await api('POST', '/device-types', {
			manufacturer_id: idOf(mfr),
			model: 'Block-1000',
			slug: 'p3-block-1000',
		})
		expect(type.status).toBe(201)

		expect((await api('DELETE', `/manufacturers/${idOf(mfr)}`)).status).toBe(409)

		expect((await api('DELETE', `/device-types/${idOf(type)}`)).status).toBe(200)
		expect((await api('DELETE', `/manufacturers/${idOf(mfr)}`)).status).toBe(200)
	})
})

describe('device types', () => {
	test('CRUD with u_height validation and manufacturer filter', async () => {
		const mfr = await api('POST', '/manufacturers', { name: 'P3 DT', slug: 'p3-dt' })
		const mfrId = idOf(mfr)

		const missing = await api('POST', '/device-types', {
			manufacturer_id: 99999,
			model: 'Ghost',
			slug: 'p3-ghost',
		})
		expect(missing.status).toBe(404)

		const negative = await api('POST', '/device-types', {
			manufacturer_id: mfrId,
			model: 'Negative',
			slug: 'p3-negative',
			u_height: -1,
		})
		expect(negative.status).toBe(400)

		const created = await api('POST', '/device-types', {
			manufacturer_id: mfrId,
			model: 'Switch 48',
			slug: 'p3-switch-48',
		})
		expect(created.status).toBe(201)
		expect((created.body as { u_height: number }).u_height).toBe(1)
		const id = idOf(created)

		// 0 = virtual/shelf-only is accepted.
		const virtual = await api('POST', '/device-types', {
			manufacturer_id: mfrId,
			model: 'Virtual',
			slug: 'p3-virtual',
			u_height: 0,
		})
		expect(virtual.status).toBe(201)

		const dup = await api('POST', '/device-types', {
			manufacturer_id: mfrId,
			model: 'Switch 48 copy',
			slug: 'p3-switch-48',
		})
		expect(dup.status).toBe(409)

		const filtered = await api('GET', '/device-types', undefined, `?manufacturer=${mfrId}`)
		expect((filtered.body as { total: number }).total).toBe(2)
		const other = await api('GET', '/device-types', undefined, '?manufacturer=99999')
		expect((other.body as { total: number }).total).toBe(0)

		const patched = await api('PATCH', `/device-types/${id}`, { u_height: 2 })
		expect(patched.status).toBe(200)
		expect((patched.body as { u_height: number }).u_height).toBe(2)
		expect((await api('PATCH', `/device-types/${id}`, { u_height: 61 })).status).toBe(400)

		expect((await api('DELETE', `/device-types/${id}`)).status).toBe(200)
		expect((await api('DELETE', `/device-types/${idOf(virtual)}`)).status).toBe(200)
		expect((await api('DELETE', `/manufacturers/${mfrId}`)).status).toBe(200)
	})
})

describe('stubs', () => {
	test('stub CRUD with count validation and expansion-collision guard', async () => {
		const mfr = await api('POST', '/manufacturers', { name: 'P3 Stub', slug: 'p3-stub' })
		const type = await api('POST', '/device-types', {
			manufacturer_id: idOf(mfr),
			model: 'Stub-24',
			slug: 'p3-stub-24',
		})
		const typeId = idOf(type)

		const stub = await api('POST', `/device-types/${typeId}/stubs`, {
			prefix: 'eth',
			count: 24,
			kind: 'ethernet',
		})
		expect(stub.status).toBe(201)
		const stubId = idOf(stub)

		const zero = await api('POST', `/device-types/${typeId}/stubs`, {
			prefix: 'mgmt',
			count: 0,
		})
		expect(zero.status).toBe(400)

		// Same prefix+kind collides on expansion.
		const clash = await api('POST', `/device-types/${typeId}/stubs`, {
			prefix: 'eth',
			count: 1,
			kind: 'ethernet',
		})
		expect(clash.status).toBe(409)

		// Same prefix with a different kind still collides: expansion is
		// name-based, so `eth0` would be produced twice.
		const samePrefix = await api('POST', `/device-types/${typeId}/stubs`, {
			prefix: 'eth',
			count: 1,
			kind: 'fiber',
		})
		expect(samePrefix.status).toBe(409)

		const ok = await api('POST', `/device-types/${typeId}/stubs`, {
			prefix: 'sfp',
			count: 2,
			kind: 'fiber',
		})
		expect(ok.status).toBe(201)

		const listed = await api('GET', `/device-types/${typeId}/stubs`)
		expect(listed.status).toBe(200)
		expect((listed.body as unknown[]).length).toBe(2)

		const patched = await api('PATCH', `/device-types/${typeId}/stubs/${stubId}`, { count: 12 })
		expect(patched.status).toBe(200)
		expect((patched.body as { count: number }).count).toBe(12)

		const preview = await api('GET', `/device-types/${typeId}/preview`)
		expect(preview.status).toBe(200)
		const names = (preview.body as StubPreviewResponse).interfaces.map((i) => i.name)
		expect(names).toEqual([...Array.from({ length: 12 }, (_, i) => `eth${i}`), 'sfp0', 'sfp1'])
		expect((preview.body as StubPreviewResponse).total).toBe(14)

		expect((await api('DELETE', `/device-types/${typeId}/stubs/${stubId}`)).status).toBe(200)
		expect((await api('DELETE', `/device-types/${typeId}/stubs/${idOf(ok)}`)).status).toBe(200)

		// Deleting the type removes its stubs with it.
		const extra = await api('POST', `/device-types/${typeId}/stubs`, {
			prefix: 'eth',
			count: 1,
		})
		expect(extra.status).toBe(201)
		expect((await api('DELETE', `/device-types/${typeId}`)).status).toBe(200)
		expect((await api('GET', `/device-types/${typeId}/stubs`)).status).toBe(404)
		expect((await api('DELETE', `/manufacturers/${idOf(mfr)}`)).status).toBe(200)
	})

	test('stub endpoints 404 on unknown device type', async () => {
		expect((await api('GET', '/device-types/99999/stubs')).status).toBe(404)
		expect((await api('GET', '/device-types/99999/preview')).status).toBe(404)
		expect(
			(await api('POST', '/device-types/99999/stubs', { prefix: 'eth', count: 1 })).status,
		).toBe(404)
	})
})

describe('ad-hoc preview', () => {
	test('eth x24 previews eth0..eth23 via query and body', async () => {
		const viaQuery = await api(
			'GET',
			'/device-types/preview',
			undefined,
			'?prefix=eth&count=24',
		)
		expect(viaQuery.status).toBe(200)
		const names = (viaQuery.body as StubPreviewResponse).interfaces.map((i) => i.name)
		expect(names).toHaveLength(24)
		expect(names[0]).toBe('eth0')
		expect(names[23]).toBe('eth23')
		expect((viaQuery.body as StubPreviewResponse).total).toBe(24)

		const viaBody = await api('POST', '/device-types/preview', {
			prefix: 'eth',
			count: 24,
			kind: 'ethernet',
		})
		expect(viaBody.status).toBe(200)
		expect((viaBody.body as StubPreviewResponse).total).toBe(24)

		expect(
			(await api('GET', '/device-types/preview', undefined, '?prefix=eth&count=0')).status,
		).toBe(400)
		expect((await api('GET', '/device-types/preview', undefined, '')).status).toBe(400)
	})
})
