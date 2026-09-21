import { beforeAll, describe, expect, test } from 'bun:test'
import { createLocalUser } from './db/users'
import { createApp } from './index'
import { initTestEnv } from './test_setup'

const app = createApp()

async function api(
	method: string,
	path: string,
	body?: unknown,
	query?: string,
	cookie = '',
): Promise<{ status: number; body: unknown; headers: Headers }> {
	const headers: Record<string, string> = {}
	if (cookie) {
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

async function loginAs(username: string, password: string): Promise<string> {
	const login = await api('POST', '/auth/login', { username, password })
	expect(login.status).toBe(200)
	const cookie = login.headers.get('set-cookie') ?? ''
	expect(cookie).toContain('auth_token=')
	return cookie
}

let adminCookie = ''
let editorCookie = ''
let viewerCookie = ''
let scopedEditorCookie = ''
let scopedViewerCookie = ''
let t1 = 0
let t2 = 0
let editorId = 0
let viewerId = 0
let scopedEditorId = 0
let scopedViewerId = 0

beforeAll(async () => {
	initTestEnv()
	// One hash for every fixture account: Bun's password hash is deliberately
	// slow, and re-hashing per user blows the default hook timeout.
	const passwordHash = await Bun.password.hash('secret123')
	createLocalUser('rbac-admin', passwordHash)
	adminCookie = await loginAs('rbac-admin', 'secret123')

	const r1 = await api(
		'POST',
		'/tenants',
		{ name: 'RBAC T1', slug: 'rbac-t1' },
		undefined,
		adminCookie,
	)
	expect(r1.status).toBe(201)
	t1 = idOf(r1)
	const r2 = await api(
		'POST',
		'/tenants',
		{ name: 'RBAC T2', slug: 'rbac-t2' },
		undefined,
		adminCookie,
	)
	expect(r2.status).toBe(201)
	t2 = idOf(r2)

	editorId = createLocalUser('rbac-editor', passwordHash, 'editor', null).id
	viewerId = createLocalUser('rbac-viewer', passwordHash, 'viewer', null).id
	scopedEditorId = createLocalUser('rbac-scoped-editor', passwordHash, 'editor', t1).id
	scopedViewerId = createLocalUser('rbac-scoped-viewer', passwordHash, 'viewer', t1).id

	editorCookie = await loginAs('rbac-editor', 'secret123')
	viewerCookie = await loginAs('rbac-viewer', 'secret123')
	scopedEditorCookie = await loginAs('rbac-scoped-editor', 'secret123')
	scopedViewerCookie = await loginAs('rbac-scoped-viewer', 'secret123')
})

describe('user management', () => {
	test('me reports role and tenant scope', async () => {
		const me = (await api('GET', '/auth/me', undefined, undefined, adminCookie)).body as Record<
			string,
			unknown
		>
		expect(me.username).toBe('rbac-admin')
		expect(me.role).toBe('admin')
		expect(me.tenant_id).toBeNull()
		const scoped = (await api('GET', '/auth/me', undefined, undefined, scopedEditorCookie))
			.body as Record<string, unknown>
		expect(scoped.role).toBe('editor')
		expect(scoped.tenant_id).toBe(t1)
	})

	test('user create validates input', async () => {
		// Default role is viewer.
		const def = await api(
			'POST',
			'/users',
			{ username: 'rbac-default', password: 'secret123' },
			undefined,
			adminCookie,
		)
		expect(def.status).toBe(201)
		expect((def.body as Record<string, unknown>).role).toBe('viewer')
		expect((def.body as Record<string, unknown>).password_hash).toBeUndefined()
		// Duplicate username.
		expect(
			(
				await api(
					'POST',
					'/users',
					{ username: 'rbac-default', password: 'x' },
					undefined,
					adminCookie,
				)
			).status,
		).toBe(409)
		// Unknown tenant.
		expect(
			(
				await api(
					'POST',
					'/users',
					{ username: 'rbac-a', password: 'x', tenant_id: 999999 },
					undefined,
					adminCookie,
				)
			).status,
		).toBe(404)
		// Admins are global: a tenant scope is rejected.
		expect(
			(
				await api(
					'POST',
					'/users',
					{ username: 'rbac-b', password: 'x', role: 'admin', tenant_id: t1 },
					undefined,
					adminCookie,
				)
			).status,
		).toBe(409)
		expect(
			(await api('DELETE', `/users/${idOf(def)}`, undefined, undefined, adminCookie)).status,
		).toBe(200)
	})

	test('non-admins cannot touch user management', async () => {
		expect((await api('GET', '/users', undefined, undefined, editorCookie)).status).toBe(403)
		expect((await api('GET', '/users', undefined, undefined, viewerCookie)).status).toBe(403)
		expect(
			(
				await api(
					'POST',
					'/users',
					{ username: 'rbac-c', password: 'x' },
					undefined,
					editorCookie,
				)
			).status,
		).toBe(403)
		expect(
			(await api('GET', `/users/${editorId}`, undefined, undefined, viewerCookie)).status,
		).toBe(403)
		expect(
			(await api('PATCH', `/users/${viewerId}`, { role: 'editor' }, undefined, editorCookie))
				.status,
		).toBe(403)
		expect((await api('GET', '/users', undefined, undefined, '')).status).toBe(401)
	})

	test('admin can list, read, update, and delete users', async () => {
		const list = (await api('GET', '/users', undefined, undefined, adminCookie)).body as {
			items: Array<{ username: string }>
			total: number
		}
		expect(list.items.some((u) => u.username === 'rbac-editor')).toBe(true)
		const one = await api('GET', `/users/${editorId}`, undefined, undefined, adminCookie)
		expect(one.status).toBe(200)
		const upd = await api(
			'PATCH',
			`/users/${viewerId}`,
			{ role: 'editor', tenant_id: t2 },
			undefined,
			adminCookie,
		)
		expect(upd.status).toBe(200)
		expect((upd.body as Record<string, unknown>).tenant_id).toBe(t2)
		// Back to viewer for the role tests below.
		expect(
			(
				await api(
					'PATCH',
					`/users/${viewerId}`,
					{ role: 'viewer', tenant_id: null },
					undefined,
					adminCookie,
				)
			).status,
		).toBe(200)
		expect((await api('GET', '/users/999999', undefined, undefined, adminCookie)).status).toBe(
			404,
		)
	})

	test('password reset works and self-delete is blocked', async () => {
		expect(
			(
				await api(
					'PATCH',
					`/users/${viewerId}`,
					{ password: 'new-secret-456' },
					undefined,
					adminCookie,
				)
			).status,
		).toBe(200)
		// Old password stops working, new one works.
		expect(
			(
				await api('POST', '/auth/login', {
					username: 'rbac-viewer',
					password: 'secret123',
				})
			).status,
		).toBe(401)
		viewerCookie = await loginAs('rbac-viewer', 'new-secret-456')
		// Nobody can delete their own account.
		const adminId = (
			(await api('GET', '/users', undefined, '?search=rbac-admin', adminCookie)).body as {
				items: Array<{ id: number }>
			}
		).items[0].id
		expect(
			(await api('DELETE', `/users/${adminId}`, undefined, undefined, adminCookie)).status,
		).toBe(409)
	})

	test('setup is closed once users exist', async () => {
		expect(
			(await api('POST', '/auth/setup', { username: 'rbac-late', password: 'x' })).status,
		).toBe(409)
	})
})

describe('role enforcement', () => {
	test('viewers read but never write', async () => {
		expect((await api('GET', '/tenants', undefined, undefined, viewerCookie)).status).toBe(200)
		expect(
			(await api('GET', '/manufacturers', undefined, undefined, viewerCookie)).status,
		).toBe(200)
		for (const [method, path, body] of [
			['POST', '/tenants', { name: 'X', slug: 'rbac-x' }],
			['POST', '/sites', { name: 'X', slug: 'rbac-x' }],
			['POST', '/manufacturers', { name: 'X', slug: 'rbac-x' }],
			['POST', '/devices', { device_type_id: 1, name: 'X' }],
			['POST', '/cables', { a_interface_id: 1, b_interface_id: 2 }],
		] as Array<[string, string, unknown]>) {
			expect((await api(method, path, body, undefined, viewerCookie)).status).toBe(403)
		}
		expect(
			(await api('POST', '/devices/import', { csv: 'name\nx' }, undefined, viewerCookie))
				.status,
		).toBe(403)
	})

	test('global editors read and write everything except users', async () => {
		const site = await api(
			'POST',
			'/sites',
			{ name: 'RBAC Ed', slug: 'rbac-ed' },
			undefined,
			editorCookie,
		)
		expect(site.status).toBe(201)
		expect(
			(
				await api(
					'PATCH',
					`/sites/${idOf(site)}`,
					{ description: 'd' },
					undefined,
					editorCookie,
				)
			).status,
		).toBe(200)
		const mfr = await api(
			'POST',
			'/manufacturers',
			{ name: 'RBAC M', slug: 'rbac-m' },
			undefined,
			editorCookie,
		)
		expect(mfr.status).toBe(201)
		expect(
			(await api('DELETE', `/manufacturers/${idOf(mfr)}`, undefined, undefined, editorCookie))
				.status,
		).toBe(200)
		expect(
			(await api('DELETE', `/sites/${idOf(site)}`, undefined, undefined, editorCookie))
				.status,
		).toBe(200)
	})
})

describe('single-tenant scope', () => {
	test('tenant list and detail are pinned to the scope', async () => {
		const list = (await api('GET', '/tenants', undefined, undefined, scopedEditorCookie))
			.body as {
			items: Array<{ id: number }>
			total: number
		}
		expect(list.total).toBe(1)
		expect(list.items[0].id).toBe(t1)
		expect(
			(await api('GET', `/tenants/${t1}`, undefined, undefined, scopedEditorCookie)).status,
		).toBe(200)
		expect(
			(await api('GET', `/tenants/${t2}`, undefined, undefined, scopedEditorCookie)).status,
		).toBe(403)
		expect(
			(
				await api(
					'POST',
					'/tenants',
					{ name: 'X', slug: 'rbac-x' },
					undefined,
					scopedEditorCookie,
				)
			).status,
		).toBe(403)
		expect(
			(await api('PATCH', `/tenants/${t1}`, { name: 'Y' }, undefined, scopedEditorCookie))
				.status,
		).toBe(403)
		expect(
			(await api('DELETE', `/tenants/${t1}`, undefined, undefined, scopedEditorCookie))
				.status,
		).toBe(403)
	})

	test('scoped editor writes land in the scope tenant', async () => {
		// Omitted tenant auto-fills to the scope.
		const auto = await api(
			'POST',
			'/sites',
			{ name: 'RBAC S1', slug: 'rbac-s1' },
			undefined,
			scopedEditorCookie,
		)
		expect(auto.status).toBe(201)
		expect((auto.body as Record<string, unknown>).tenant_id).toBe(t1)
		// Explicit own tenant works; any other tenant is rejected.
		const own = await api(
			'POST',
			'/sites',
			{ name: 'RBAC S2', slug: 'rbac-s2', tenant_id: t1 },
			undefined,
			scopedEditorCookie,
		)
		expect(own.status).toBe(201)
		expect(
			(
				await api(
					'POST',
					'/sites',
					{ name: 'RBAC S3', slug: 'rbac-s3', tenant_id: t2 },
					undefined,
					scopedEditorCookie,
				)
			).status,
		).toBe(403)
		expect(
			(
				await api(
					'POST',
					'/sites',
					{ name: 'RBAC S4', slug: 'rbac-s4', tenant_id: null },
					undefined,
					scopedEditorCookie,
				)
			).status,
		).toBe(403)
		// Cross-tenant query params are rejected, not silently re-scoped.
		expect(
			(await api('GET', '/sites', undefined, `?tenant=${t2}`, scopedEditorCookie)).status,
		).toBe(403)
		const ownList = (await api('GET', '/sites', undefined, `?tenant=${t1}`, scopedEditorCookie))
			.body as {
			items: Array<{ tenant_id: number | null }>
		}
		expect(ownList.items.length).toBeGreaterThan(0)
		expect(ownList.items.every((s) => s.tenant_id === t1)).toBe(true)
		// Cleanup.
		expect(
			(await api('DELETE', `/sites/${idOf(auto)}`, undefined, undefined, scopedEditorCookie))
				.status,
		).toBe(200)
		expect(
			(await api('DELETE', `/sites/${idOf(own)}`, undefined, undefined, scopedEditorCookie))
				.status,
		).toBe(200)
	})

	test('scoped users cannot see null-tenant rows', async () => {
		const shared = await api(
			'POST',
			'/sites',
			{ name: 'RBAC Shared', slug: 'rbac-shared' },
			undefined,
			adminCookie,
		)
		expect(shared.status).toBe(201)
		const sharedId = idOf(shared)
		// Single-object reads are denied for both scoped roles...
		expect(
			(await api('GET', `/sites/${sharedId}`, undefined, undefined, scopedEditorCookie))
				.status,
		).toBe(403)
		expect(
			(await api('GET', `/sites/${sharedId}`, undefined, undefined, scopedViewerCookie))
				.status,
		).toBe(403)
		// ...shared rows never surface in scoped lists or search either.
		const list = (await api('GET', '/sites', undefined, undefined, scopedEditorCookie))
			.body as {
			items: Array<{ id: number }>
		}
		expect(list.items.some((s) => s.id === sharedId)).toBe(false)
		const search = (
			await api('GET', '/search', undefined, '?q=rbac-shared', scopedEditorCookie)
		).body as { sites: { items: Array<{ id: number }> } }
		expect(search.sites.items).toEqual([])
		// Writes stay denied too, while admins are unaffected.
		expect(
			(
				await api(
					'PATCH',
					`/sites/${sharedId}`,
					{ description: 'd' },
					undefined,
					scopedEditorCookie,
				)
			).status,
		).toBe(403)
		expect(
			(await api('DELETE', `/sites/${sharedId}`, undefined, undefined, scopedEditorCookie))
				.status,
		).toBe(403)
		expect(
			(await api('GET', `/sites/${sharedId}`, undefined, undefined, adminCookie)).status,
		).toBe(200)
		expect(
			(await api('DELETE', `/sites/${sharedId}`, undefined, undefined, adminCookie)).status,
		).toBe(200)
	})

	test('scoped editor cannot move rows across tenants', async () => {
		const site = await api(
			'POST',
			'/sites',
			{ name: 'RBAC Move', slug: 'rbac-move' },
			undefined,
			scopedEditorCookie,
		)
		expect(site.status).toBe(201)
		const siteId = idOf(site)
		expect(
			(
				await api(
					'PATCH',
					`/sites/${siteId}`,
					{ tenant_id: t2 },
					undefined,
					scopedEditorCookie,
				)
			).status,
		).toBe(403)
		expect(
			(
				await api(
					'PATCH',
					`/sites/${siteId}`,
					{ tenant_id: null },
					undefined,
					scopedEditorCookie,
				)
			).status,
		).toBe(403)
		expect(
			(
				await api(
					'PATCH',
					`/sites/${siteId}`,
					{ description: 'ok' },
					undefined,
					scopedEditorCookie,
				)
			).status,
		).toBe(200)
		expect(
			(await api('DELETE', `/sites/${siteId}`, undefined, undefined, scopedEditorCookie))
				.status,
		).toBe(200)
	})

	test('scoped users cannot edit the shared catalog', async () => {
		expect(
			(await api('GET', '/manufacturers', undefined, undefined, scopedViewerCookie)).status,
		).toBe(200)
		expect(
			(
				await api(
					'POST',
					'/manufacturers',
					{ name: 'X', slug: 'rbac-x' },
					undefined,
					scopedEditorCookie,
				)
			).status,
		).toBe(403)
		expect(
			(
				await api(
					'POST',
					'/device-types',
					{ manufacturer_id: 1, model: 'X', slug: 'rbac-x' },
					undefined,
					scopedEditorCookie,
				)
			).status,
		).toBe(403)
	})

	test('shelves follow their rack tenant', async () => {
		const rackT1 = await api(
			'POST',
			'/racks',
			{ name: 'RBAC R1', slug: 'rbac-r1', site_id: null, tenant_id: t1 },
			undefined,
			adminCookie,
		)
		// Racks require a site: create scope-local sites instead.
		expect(rackT1.status).toBe(400)
		const siteT1 = await api(
			'POST',
			'/sites',
			{ name: 'RBAC RS1', slug: 'rbac-rs1', tenant_id: t1 },
			undefined,
			adminCookie,
		)
		const siteT2 = await api(
			'POST',
			'/sites',
			{ name: 'RBAC RS2', slug: 'rbac-rs2', tenant_id: t2 },
			undefined,
			adminCookie,
		)
		const r1 = await api(
			'POST',
			'/racks',
			{ name: 'RBAC R1', slug: 'rbac-r1', site_id: idOf(siteT1), tenant_id: t1 },
			undefined,
			adminCookie,
		)
		const r2 = await api(
			'POST',
			'/racks',
			{ name: 'RBAC R2', slug: 'rbac-r2', site_id: idOf(siteT2), tenant_id: t2 },
			undefined,
			adminCookie,
		)
		expect(r1.status).toBe(201)
		expect(r2.status).toBe(201)
		const rack1 = idOf(r1)
		const rack2 = idOf(r2)
		const ok = await api(
			'POST',
			'/shelves',
			{ name: 'S1', rack_id: rack1, position_u: 1 },
			undefined,
			scopedEditorCookie,
		)
		expect(ok.status).toBe(201)
		expect(
			(
				await api(
					'POST',
					'/shelves',
					{ name: 'S2', rack_id: rack2, position_u: 1 },
					undefined,
					scopedEditorCookie,
				)
			).status,
		).toBe(403)
		expect(
			(await api('GET', `/shelves/${idOf(ok)}`, undefined, undefined, scopedViewerCookie))
				.status,
		).toBe(200)
		const shelves = (await api('GET', '/shelves', undefined, undefined, scopedEditorCookie))
			.body as {
			items: Array<{ id: number }>
		}
		expect(shelves.items.some((s) => s.id === idOf(ok))).toBe(true)
		expect(
			(await api('DELETE', `/shelves/${idOf(ok)}`, undefined, undefined, scopedEditorCookie))
				.status,
		).toBe(200)
		expect(
			(await api('DELETE', `/racks/${rack1}`, undefined, undefined, adminCookie)).status,
		).toBe(200)
		expect(
			(await api('DELETE', `/racks/${rack2}`, undefined, undefined, adminCookie)).status,
		).toBe(200)
		expect(
			(await api('DELETE', `/sites/${idOf(siteT1)}`, undefined, undefined, adminCookie))
				.status,
		).toBe(200)
		expect(
			(await api('DELETE', `/sites/${idOf(siteT2)}`, undefined, undefined, adminCookie))
				.status,
		).toBe(200)
	})

	test('cables follow both endpoint tenants', async () => {
		const mfr = await api(
			'POST',
			'/manufacturers',
			{ name: 'RBAC CM', slug: 'rbac-cm' },
			undefined,
			adminCookie,
		)
		const dt = await api(
			'POST',
			'/device-types',
			{ manufacturer_id: idOf(mfr), model: 'RBAC Box', slug: 'rbac-box' },
			undefined,
			adminCookie,
		)
		const stub = await api(
			'POST',
			`/device-types/${idOf(dt)}/stubs`,
			{ prefix: 'eth', count: 2 },
			undefined,
			adminCookie,
		)
		expect(stub.status).toBe(201)
		const mkDevice = async (name: string, tenant: number | null): Promise<number> => {
			const res = await api(
				'POST',
				'/devices',
				{ device_type_id: idOf(dt), name, tenant_id: tenant },
				undefined,
				adminCookie,
			)
			expect(res.status).toBe(201)
			return idOf(res)
		}
		const d1 = await mkDevice('rbac-d1', t1)
		const d2 = await mkDevice('rbac-d2', t1)
		const d3 = await mkDevice('rbac-d3', t2)
		const ifacesOf = async (id: number): Promise<Map<string, number>> => {
			const res = (
				await api('GET', `/devices/${id}/interfaces`, undefined, undefined, adminCookie)
			).body as {
				items?: Array<{ id: number; name: string }>
			}
			const list = (res.items ?? res) as Array<{ id: number; name: string }>
			return new Map(list.map((i) => [i.name, i.id]))
		}
		const i1 = (await ifacesOf(d1)).get('eth0') as number
		const i2 = (await ifacesOf(d2)).get('eth0') as number
		const i3 = (await ifacesOf(d3)).get('eth0') as number
		// Same-scope cable works; cross-tenant cable is rejected.
		const cable = await api(
			'POST',
			'/cables',
			{ a_interface_id: i1, b_interface_id: i2 },
			undefined,
			scopedEditorCookie,
		)
		expect(cable.status).toBe(201)
		expect(
			(
				await api(
					'POST',
					'/cables',
					{ a_interface_id: i1, b_interface_id: i3 },
					undefined,
					scopedEditorCookie,
				)
			).status,
		).toBe(403)
		// Scoped list hides the cross-tenant world; scoped read of own cable works.
		const cables = (await api('GET', '/cables', undefined, undefined, scopedEditorCookie))
			.body as {
			items: Array<{ id: number }>
		}
		expect(cables.items.some((x) => x.id === idOf(cable))).toBe(true)
		expect(
			(await api('GET', `/cables/${idOf(cable)}`, undefined, undefined, scopedViewerCookie))
				.status,
		).toBe(200)
		expect(
			(
				await api(
					'DELETE',
					`/cables/${idOf(cable)}`,
					undefined,
					undefined,
					scopedEditorCookie,
				)
			).status,
		).toBe(200)
		for (const d of [d1, d2, d3]) {
			expect(
				(await api('DELETE', `/devices/${d}`, undefined, undefined, adminCookie)).status,
			).toBe(200)
		}
	})

	test('search is tenant-filtered', async () => {
		const res = (await api('GET', '/search', undefined, '?q=rbac-t', scopedEditorCookie))
			.body as {
			tenants: { items: Array<{ id: number }> }
			sites: { items: Array<{ id: number }> }
		}
		expect(res.tenants.items.map((t) => t.id)).toEqual([t1])
		const adminRes = (await api('GET', '/search', undefined, '?q=rbac-t', adminCookie))
			.body as {
			tenants: { items: Array<{ id: number }> }
		}
		expect(adminRes.tenants.items.map((t) => t.id).sort()).toEqual([t1, t2].sort())
	})

	test('scoped CSV import assigns the scope and rejects foreign rows', async () => {
		const siteT2 = await api(
			'POST',
			'/sites',
			{ name: 'RBAC IS2', slug: 'rbac-is2', tenant_id: t2 },
			undefined,
			adminCookie,
		)
		const siteT1 = await api(
			'POST',
			'/sites',
			{ name: 'RBAC IS1', slug: 'rbac-is1', tenant_id: t1 },
			undefined,
			adminCookie,
		)
		const csv = [
			'name,asset_tag,device_type_slug,site_slug,rack_slug,position_u,status',
			'rbac-imp-ok,,rbac-box,rbac-is1,,,active',
			'rbac-imp-bad,,rbac-box,rbac-is2,,,active',
		].join('\n')
		const res = await api('POST', '/devices/import', { csv }, undefined, scopedEditorCookie)
		expect(res.status).toBe(201)
		const body = res.body as {
			created: number
			failed: number
			rows: Array<{ ok: boolean; id: number | null }>
		}
		expect(body.created).toBe(1)
		expect(body.failed).toBe(1)
		const createdId = (body.rows.find((r) => r.ok) as { id: number }).id
		// Imported device landed in the scope tenant even though the row has no tenant column.
		const dev = (await api('GET', `/devices/${createdId}`, undefined, undefined, adminCookie))
			.body as Record<string, unknown>
		expect(dev.tenant_id).toBe(t1)
		expect(
			(await api('DELETE', `/devices/${createdId}`, undefined, undefined, adminCookie))
				.status,
		).toBe(200)
		expect(
			(await api('DELETE', `/sites/${idOf(siteT1)}`, undefined, undefined, adminCookie))
				.status,
		).toBe(200)
		expect(
			(await api('DELETE', `/sites/${idOf(siteT2)}`, undefined, undefined, adminCookie))
				.status,
		).toBe(200)
	})

	test('tenant delete is blocked while users reference it', async () => {
		expect(
			(await api('DELETE', `/tenants/${t1}`, undefined, undefined, adminCookie)).status,
		).toBe(409)
		// Re-scope both scoped users away, then the tenant (with no children left) deletes.
		expect(
			(
				await api(
					'PATCH',
					`/users/${scopedEditorId}`,
					{ tenant_id: t2 },
					undefined,
					adminCookie,
				)
			).status,
		).toBe(200)
		expect(
			(
				await api(
					'PATCH',
					`/users/${scopedViewerId}`,
					{ tenant_id: t2 },
					undefined,
					adminCookie,
				)
			).status,
		).toBe(200)
		expect(
			(await api('DELETE', `/tenants/${t1}`, undefined, undefined, adminCookie)).status,
		).toBe(200)
		// Restore scope for tidiness (tenant is gone, so back to global).
		expect(
			(
				await api(
					'PATCH',
					`/users/${scopedEditorId}`,
					{ tenant_id: null },
					undefined,
					adminCookie,
				)
			).status,
		).toBe(200)
		expect(
			(
				await api(
					'PATCH',
					`/users/${scopedViewerId}`,
					{ tenant_id: null },
					undefined,
					adminCookie,
				)
			).status,
		).toBe(200)
	})
})
