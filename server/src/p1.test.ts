import { beforeAll, describe, expect, test } from 'bun:test'
import { MAX_LOCATION_DEPTH, MAX_SITE_GROUP_DEPTH, SlugSchema } from 'shared/src/schemas'
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

function idOf(res: { body: unknown }): number {
	return (res.body as { id: number }).id
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
		for (const path of ['/tenants', '/sites', '/locations']) {
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

describe('tenants and sites', () => {
	test('tenant filter and site delete-block chain', async () => {
		const t1 = await api('POST', '/tenants', { name: 'T1', slug: 't1' })
		const t2 = await api('POST', '/tenants', { name: 'T2', slug: 't2' })
		expect(t1.status).toBe(201)
		expect(t2.status).toBe(201)

		const site = await api('POST', '/sites', {
			name: 'DC1',
			slug: 'dc1',
			tenant_id: idOf(t1),
			comments: 'Main datacenter',
			physical_address: '123 Main St',
			shipping_address: 'PO Box 456',
		})
		expect(site.status).toBe(201)
		const siteId = idOf(site)
		const siteBody = site.body as Record<string, unknown>
		expect(siteBody.comments).toBe('Main datacenter')
		expect(siteBody.physical_address).toBe('123 Main St')
		expect(siteBody.shipping_address).toBe('PO Box 456')

		const fetched = await api('GET', `/sites/${siteId}`)
		expect(fetched.status).toBe(200)
		const fetchedBody = fetched.body as Record<string, unknown>
		expect(fetchedBody.comments).toBe('Main datacenter')
		expect(fetchedBody.physical_address).toBe('123 Main St')
		expect(fetchedBody.shipping_address).toBe('PO Box 456')

		const patched = await api('PATCH', `/sites/${siteId}`, {
			physical_address: '789 Updated Ave',
			shipping_address: null,
		})
		expect(patched.status).toBe(200)
		const patchedBody = patched.body as Record<string, unknown>
		expect(patchedBody.physical_address).toBe('789 Updated Ave')
		expect(patchedBody.shipping_address).toBeNull()
		expect(patchedBody.comments).toBe('Main datacenter')

		const refetched = await api('GET', `/sites/${siteId}`)
		expect((refetched.body as Record<string, unknown>).physical_address).toBe('789 Updated Ave')
		expect((refetched.body as Record<string, unknown>).shipping_address).toBeNull()

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
			items: Array<{ id: number; parent_id: number | null }>
		}
		const byId = new Map(all.items.map((l) => [l.id, l.parent_id]))
		const depthOfTest = (id: number): number => {
			let d = 0
			let cur: number | null | undefined = id
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
		const mk = async (slug: string, parent: number | null): Promise<number> => {
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
		let p: number | null = null
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
				items: Array<{ id: number }>
			}
		).items[0].id
		expect((await api('PATCH', `/locations/${b1}`, { parent_id: a4 })).status).toBe(200)

		const all = (await api('GET', '/locations', undefined, `?site=${siteId}&limit=200`))
			.body as {
			items: Array<{ id: number; parent_id: number | null }>
		}
		const byId = new Map(all.items.map((l) => [l.id, l.parent_id]))
		const depth = (id: number): number => {
			let d = 0
			let cur: number | null | undefined = id
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

describe('site groups', () => {
	test('nesting, sibling slugs, depth cap, cycles, and delete blocks', async () => {
		const root = await api('POST', '/site-groups', {
			name: 'Region A',
			slug: 'region-a',
			description: 'Primary region',
			comments: 'Top-level group',
		})
		expect(root.status).toBe(201)
		const rootBody = root.body as Record<string, unknown>
		expect(rootBody.description).toBe('Primary region')
		expect(rootBody.comments).toBe('Top-level group')
		let parentId = idOf(root)

		// Build down to the depth cap (root counts as level 1).
		for (let level = 2; level <= MAX_SITE_GROUP_DEPTH; level += 1) {
			const child = await api('POST', '/site-groups', {
				name: `Level ${level}`,
				slug: `level-${level}`,
				parent_id: parentId,
			})
			expect(child.status).toBe(201)
			parentId = idOf(child)
		}

		const tooDeep = await api('POST', '/site-groups', {
			name: 'Too deep',
			slug: 'too-deep',
			parent_id: parentId,
		})
		expect(tooDeep.status).toBe(409)

		// Same slug under a different parent is allowed (unique per parent).
		const otherRoot = await api('POST', '/site-groups', {
			name: 'Region B',
			slug: 'region-b',
		})
		expect(otherRoot.status).toBe(201)
		const sameSlug = await api('POST', '/site-groups', {
			name: 'Level 2 copy',
			slug: 'level-2',
			parent_id: idOf(otherRoot),
		})
		expect(sameSlug.status).toBe(201)

		// Same slug under the same parent is rejected.
		const dupSibling = await api('POST', '/site-groups', {
			name: 'Level 2 dup',
			slug: 'level-2',
			parent_id: idOf(otherRoot),
		})
		expect(dupSibling.status).toBe(409)

		// Same slug at the root level is rejected.
		const dupRoot = await api('POST', '/site-groups', {
			name: 'Region A copy',
			slug: 'region-a',
		})
		expect(dupRoot.status).toBe(409)

		// Unknown parent is rejected.
		const badParent = await api('POST', '/site-groups', {
			name: 'Orphan',
			slug: 'orphan-group',
			parent_id: 999999,
		})
		expect(badParent.status).toBe(404)

		// Self-parent and descendant-parent are rejected.
		expect(
			(await api('PATCH', `/site-groups/${parentId}`, { parent_id: parentId })).status,
		).toBe(409)
		expect(
			(await api('PATCH', `/site-groups/${idOf(root)}`, { parent_id: parentId })).status,
		).toBe(409)

		// Parent filter.
		const byParent = await api('GET', '/site-groups', undefined, `?parent=${idOf(otherRoot)}`)
		expect((byParent.body as { total: number }).total).toBe(1)

		// Delete blocked while child groups exist.
		expect((await api('DELETE', `/site-groups/${idOf(root)}`)).status).toBe(409)

		// Delete blocked while sites reference the group.
		const site = await api('POST', '/sites', {
			name: 'Grouped',
			slug: 'grouped-site',
			site_group_id: idOf(otherRoot),
		})
		expect(site.status).toBe(201)
		expect((site.body as Record<string, unknown>).site_group_id).toBe(idOf(otherRoot))
		expect((await api('DELETE', `/site-groups/${idOf(otherRoot)}`)).status).toBe(409)

		// Site filter ?group= works.
		const byGroup = await api('GET', '/sites', undefined, `?group=${idOf(otherRoot)}`)
		expect((byGroup.body as { total: number }).total).toBe(1)

		// Site with an unknown group is rejected.
		const badGroupSite = await api('POST', '/sites', {
			name: 'Bad group',
			slug: 'bad-group-site',
			site_group_id: 999999,
		})
		expect(badGroupSite.status).toBe(404)

		// Unassign the site, then delete it.
		expect((await api('PATCH', `/sites/${idOf(site)}`, { site_group_id: null })).status).toBe(
			200,
		)
		expect((await api('DELETE', `/sites/${idOf(site)}`)).status).toBe(200)

		// Cleanup deepest-first.
		const all = (await api('GET', '/site-groups', undefined, '?limit=200')).body as {
			items: Array<{ id: number; parent_id: number | null }>
		}
		const byId = new Map(all.items.map((g) => [g.id, g.parent_id]))
		const depthOfTest = (id: number): number => {
			let d = 0
			let cur: number | null | undefined = id
			while (cur) {
				d += 1
				cur = byId.get(cur) ?? null
			}
			return d
		}
		const deepestFirst = [...all.items].sort((a, b) => depthOfTest(b.id) - depthOfTest(a.id))
		for (const group of deepestFirst) {
			expect((await api('DELETE', `/site-groups/${group.id}`)).status).toBe(200)
		}
	})
})
