import { beforeAll, describe, expect, test } from 'bun:test'
import { MAX_LOCATION_DEPTH, SlugSchema } from 'shared/src/schemas'
import * as v from 'valibot'
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

function idOf(res: { body: unknown }): string {
	return (res.body as { id: string }).id
}

beforeAll(async () => {
	initTestEnv()
	createLocalUser('admin@example.com', await Bun.password.hash('secret123'))
	const login = await api('POST', '/auth/login', {
		email: 'admin@example.com',
		password: 'secret123',
	})
	expect(login.status).toBe(200)
	cookie = login.headers.get('set-cookie') ?? ''
	expect(cookie).toContain('auth_token=')
})

describe('auth guard', () => {
	test('P1 endpoints require authentication', async () => {
		for (const path of ['/tenant-groups', '/tenants', '/sites', '/locations']) {
			const res = await api('GET', path, undefined, undefined, false)
			expect(res.status).toBe(401)
		}
	})
})

describe('slug contract', () => {
	test('depth cap constant is 5', () => {
		expect(MAX_LOCATION_DEPTH).toBe(5)
	})

	test('accepts lowercase dashed slugs', () => {
		expect(v.safeParse(SlugSchema, 'dc1-row-a').success).toBe(true)
	})

	test('rejects uppercase, spaces, and edge dashes', () => {
		for (const bad of ['DC1', 'dc 1', '-dc1', 'dc1-', 'dc--1', '', 'a'.repeat(101)]) {
			expect(v.safeParse(SlugSchema, bad).success).toBe(false)
		}
	})
})

describe('tenant groups', () => {
	test('full CRUD', async () => {
		const created = await api('POST', '/tenant-groups', { name: 'Acme', slug: 'acme' })
		expect(created.status).toBe(201)
		const id = idOf(created)

		const dup = await api('POST', '/tenant-groups', { name: 'Acme 2', slug: 'acme' })
		expect(dup.status).toBe(409)

		const listed = await api('GET', '/tenant-groups', undefined, '?search=acm')
		expect(listed.status).toBe(200)
		expect((listed.body as { total: number }).total).toBe(1)

		const bad = await api('POST', '/tenant-groups', { name: 'Bad', slug: 'BAD SLUG' })
		expect(bad.status).toBe(400)

		const updated = await api('PATCH', `/tenant-groups/${id}`, { name: 'Acme Inc' })
		expect(updated.status).toBe(200)
		expect((updated.body as { name: string }).name).toBe('Acme Inc')

		const missing = await api('GET', '/tenant-groups/does-not-exist')
		expect(missing.status).toBe(404)

		const deleted = await api('DELETE', `/tenant-groups/${id}`)
		expect(deleted.status).toBe(200)
		expect((await api('GET', `/tenant-groups/${id}`)).status).toBe(404)
	})

	test('delete blocked while tenants reference the group', async () => {
		const group = await api('POST', '/tenant-groups', { name: 'G', slug: 'g-del' })
		const tenant = await api('POST', '/tenants', {
			name: 'T',
			slug: 't-del',
			group_id: idOf(group),
		})
		expect(tenant.status).toBe(201)

		const blocked = await api('DELETE', `/tenant-groups/${idOf(group)}`)
		expect(blocked.status).toBe(409)

		expect((await api('DELETE', `/tenants/${idOf(tenant)}`)).status).toBe(200)
		expect((await api('DELETE', `/tenant-groups/${idOf(group)}`)).status).toBe(200)
	})
})

describe('tenants and sites', () => {
	test('tenant filter and site delete-block chain', async () => {
		const group = await api('POST', '/tenant-groups', { name: 'G2', slug: 'g2' })
		const t1 = await api('POST', '/tenants', {
			name: 'T1',
			slug: 't1',
			group_id: idOf(group),
		})
		const t2 = await api('POST', '/tenants', { name: 'T2', slug: 't2' })
		expect(t1.status).toBe(201)
		expect(t2.status).toBe(201)

		const filtered = await api('GET', '/tenants', undefined, `?group_id=${idOf(group)}`)
		expect((filtered.body as { total: number }).total).toBe(1)

		const badGroup = await api('POST', '/tenants', {
			name: 'TX',
			slug: 'tx',
			group_id: 'missing',
		})
		expect(badGroup.status).toBe(404)

		const site = await api('POST', '/sites', {
			name: 'DC1',
			slug: 'dc1',
			tenant_id: idOf(t1),
			group: 'primary',
		})
		expect(site.status).toBe(201)

		const dupSite = await api('POST', '/sites', { name: 'DC1 copy', slug: 'dc1' })
		expect(dupSite.status).toBe(409)

		const byTenant = await api('GET', '/sites', undefined, `?tenant=${idOf(t1)}`)
		expect((byTenant.body as { total: number }).total).toBe(1)
		const byOther = await api('GET', '/sites', undefined, `?tenant=${idOf(t2)}`)
		expect((byOther.body as { total: number }).total).toBe(0)

		const blockedTenant = await api('DELETE', `/tenants/${idOf(t1)}`)
		expect(blockedTenant.status).toBe(409)

		expect((await api('DELETE', `/sites/${idOf(site)}`)).status).toBe(200)
		expect((await api('DELETE', `/tenants/${idOf(t1)}`)).status).toBe(200)
		expect((await api('DELETE', `/tenants/${idOf(t2)}`)).status).toBe(200)
		expect((await api('DELETE', `/tenant-groups/${idOf(group)}`)).status).toBe(200)
	})
})

describe('locations', () => {
	test('nesting, sibling slugs, depth cap, and delete blocks', async () => {
		const site = await api('POST', '/sites', { name: 'HQ', slug: 'hq' })
		const siteId = idOf(site)

		const root = await api('POST', '/locations', {
			name: 'Floor 1',
			slug: 'floor-1',
			site_id: siteId,
		})
		expect(root.status).toBe(201)
		let parentId = idOf(root)

		// Build down to the depth cap (root counts as level 1).
		for (let level = 2; level <= MAX_LOCATION_DEPTH; level += 1) {
			const child = await api('POST', '/locations', {
				name: `Level ${level}`,
				slug: `level-${level}`,
				site_id: siteId,
				parent_id: parentId,
			})
			expect(child.status).toBe(201)
			parentId = idOf(child)
		}

		const tooDeep = await api('POST', '/locations', {
			name: 'Too deep',
			slug: 'too-deep',
			site_id: siteId,
			parent_id: parentId,
		})
		expect(tooDeep.status).toBe(409)

		// Same slug under a different parent is allowed (unique per parent).
		const otherRoot = await api('POST', '/locations', {
			name: 'Floor 2',
			slug: 'floor-2',
			site_id: siteId,
		})
		const sameSlug = await api('POST', '/locations', {
			name: 'Level 2 copy',
			slug: 'level-2',
			site_id: siteId,
			parent_id: idOf(otherRoot),
		})
		expect(sameSlug.status).toBe(201)

		// Same slug under the same parent is rejected.
		const dupSibling = await api('POST', '/locations', {
			name: 'Level 2 dup',
			slug: 'level-2',
			site_id: siteId,
			parent_id: idOf(otherRoot),
		})
		expect(dupSibling.status).toBe(409)

		// Cross-site parent is rejected.
		const otherSite = await api('POST', '/sites', { name: 'Branch', slug: 'branch' })
		const crossSite = await api('POST', '/locations', {
			name: 'X',
			slug: 'x-loc',
			site_id: idOf(otherSite),
			parent_id: parentId,
		})
		expect(crossSite.status).toBe(404)

		// Self-parent and descendant-parent are rejected.
		expect((await api('PATCH', `/locations/${parentId}`, { parent_id: parentId })).status).toBe(
			409,
		)
		expect(
			(await api('PATCH', `/locations/${idOf(root)}`, { parent_id: parentId })).status,
		).toBe(409)

		// Filters.
		const bySite = await api('GET', '/locations', undefined, `?site=${siteId}`)
		expect((bySite.body as { total: number }).total).toBe(MAX_LOCATION_DEPTH + 2)
		const byParent = await api(
			'GET',
			'/locations',
			undefined,
			`?site=${siteId}&parent=${idOf(otherRoot)}`,
		)
		expect((byParent.body as { total: number }).total).toBe(1)

		// Delete blocked while children exist; site blocked while locations exist.
		expect((await api('DELETE', `/locations/${idOf(root)}`)).status).toBe(409)
		expect((await api('DELETE', `/sites/${siteId}`)).status).toBe(409)

		// Cleanup deepest-first.
		const all = (await api('GET', '/locations', undefined, `?site=${siteId}&limit=200`))
			.body as {
			items: Array<{ id: string; parent_id: string | null }>
		}
		const byId = new Map(all.items.map((l) => [l.id, l.parent_id]))
		const depthOfTest = (id: string): number => {
			let d = 0
			let cur: string | null | undefined = id
			while (cur) {
				d += 1
				cur = byId.get(cur) ?? null
			}
			return d
		}
		const deepestFirst = [...all.items].sort((a, b) => depthOfTest(b.id) - depthOfTest(a.id))
		for (const loc of deepestFirst) {
			expect((await api('DELETE', `/locations/${loc.id}`)).status).toBe(200)
		}
		expect((await api('DELETE', `/sites/${siteId}`)).status).toBe(200)
		expect((await api('DELETE', `/sites/${idOf(otherSite)}`)).status).toBe(200)
	})

	test('moving a subtree past the depth cap is rejected', async () => {
		const site = await api('POST', '/sites', { name: 'Depth', slug: 'depth-site' })
		const siteId = idOf(site)
		const mk = async (slug: string, parent: string | null): Promise<string> => {
			const res = await api('POST', '/locations', {
				name: slug,
				slug,
				site_id: siteId,
				parent_id: parent,
			})
			expect(res.status).toBe(201)
			return idOf(res)
		}
		// Chain a1..a5 (depth 5) and a separate root b with child b1.
		let p: string | null = null
		for (let i = 1; i <= 5; i += 1) {
			p = await mk(`a${i}`, p)
		}
		const b = await mk('b', null)
		const b1 = await mk('b1', b)
		// Moving b (with child b1, offset 1) under a5 (depth 5) would put b1 at 7.
		expect((await api('PATCH', `/locations/${b}`, { parent_id: p })).status).toBe(409)
		// Moving leaf b1 under a4 (depth 4) lands exactly at 5: allowed.
		const a4 = (
			(await api('GET', '/locations', undefined, `?site=${siteId}&search=a4`)).body as {
				items: Array<{ id: string }>
			}
		).items[0].id
		expect((await api('PATCH', `/locations/${b1}`, { parent_id: a4 })).status).toBe(200)

		const all = (await api('GET', '/locations', undefined, `?site=${siteId}&limit=200`))
			.body as {
			items: Array<{ id: string; parent_id: string | null }>
		}
		const byId = new Map(all.items.map((l) => [l.id, l.parent_id]))
		const depth = (id: string): number => {
			let d = 0
			let cur: string | null | undefined = id
			while (cur) {
				d += 1
				cur = byId.get(cur) ?? null
			}
			return d
		}
		for (const loc of [...all.items].sort((a, b2) => depth(b2.id) - depth(a.id))) {
			expect((await api('DELETE', `/locations/${loc.id}`)).status).toBe(200)
		}
		expect((await api('DELETE', `/sites/${siteId}`)).status).toBe(200)
	})
})
