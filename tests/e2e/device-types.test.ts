import {
	type APIRequestContext,
	type APIResponse,
	expect,
	type Locator,
	type Page,
	test,
} from '@playwright/test'

// Auth comes from `auth.setup.ts` storageState — no per-test login.

interface Port {
	id: number
	name: string
	side: 'front' | 'rear' | null
	enabled: boolean
	connected: boolean
	location_id: number | null
	description: string | null
	template_name: string | null
}

interface Preview {
	orphaned: {
		interface_id: number
		name: string
		connected: boolean
		located: boolean
		suggestion: string | null
	}[]
	added: { name: string }[]
}

/** 1×1 gray PNG, enough to mark an attachment as a floor plan. */
const PLAN_PNG = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGNgAAAAAgABc3UBGAAAAABJRU5ErkJggg==',
	'base64',
)

/** Unique per call: tests run in parallel and leave nothing shared behind. */
let counter = 0
function nextId(): string {
	counter += 1
	return `${Date.now()}-${counter}`
}
const unique = (label: string): string => `E2E DT ${label} ${nextId()}`

/** Cleanup steps, run newest first so dependents go before what they use. */
class Cleanup {
	private readonly paths: string[] = []

	constructor(private readonly api: APIRequestContext) {}

	add(path: string): void {
		this.paths.push(path)
	}

	async run(): Promise<void> {
		for (const path of this.paths.reverse()) {
			await this.api.delete(`/api/${path}`)
		}
	}
}

/** Fails with the response body, which names the reason a request was refused. */
async function ok(res: APIResponse): Promise<APIResponse> {
	expect(res.ok(), `${res.url()}: ${await res.text()}`).toBeTruthy()
	return res
}

async function postJson<T>(api: APIRequestContext, path: string, data: object): Promise<T> {
	return (await (await ok(await api.post(`/api/${path}`, { data }))).json()) as T
}

/** Creates a row and registers its delete. */
async function create(
	api: APIRequestContext,
	cleanup: Cleanup,
	path: string,
	data: object,
): Promise<number> {
	const { id } = await postJson<{ id: number }>(api, path, data)
	cleanup.add(`${path}/${id}`)
	return id
}

async function findId(
	api: APIRequestContext,
	path: string,
	key: string,
	value: string,
): Promise<number> {
	const sep = path.includes('?') ? '&' : '?'
	const res = await ok(
		await api.get(`/api/${path}${sep}search=${encodeURIComponent(value)}&page=1&limit=200`),
	)
	const body = (await res.json()) as { items: ({ id: number } & Record<string, unknown>)[] }
	const match = body.items.find((item) => item[key] === value)
	expect(match, `${path} "${value}" is seeded`).toBeDefined()
	return match?.id ?? 0
}

const maker = (api: APIRequestContext): Promise<number> =>
	findId(api, 'manufacturers', 'name', 'E2E Maker')
const role = (api: APIRequestContext): Promise<number> =>
	findId(api, 'device-roles', 'name', 'E2E Role')

async function createType(
	api: APIRequestContext,
	cleanup: Cleanup,
	fields: object = {},
): Promise<number> {
	return create(api, cleanup, 'device-types', {
		manufacturer_id: await maker(api),
		model: unique('Type'),
		...fields,
	})
}

/** A stub's delete runs with the type's, so it is not registered. */
async function createStub(api: APIRequestContext, typeId: number, stub: object): Promise<number> {
	const { id } = await postJson<{ id: number }>(api, `device-types/${typeId}/stubs`, stub)
	return id
}

async function createDevice(
	api: APIRequestContext,
	cleanup: Cleanup,
	typeId: number,
	fields: object = {},
): Promise<number> {
	return create(api, cleanup, 'devices', {
		device_type_id: typeId,
		device_role_id: await role(api),
		name: unique('Device'),
		...fields,
	})
}

async function portsOf(api: APIRequestContext, deviceId: number): Promise<Port[]> {
	const res = await ok(await api.get(`/api/devices/${deviceId}/interfaces?page=1&limit=200`))
	const body = (await res.json()) as Port[] | { items: Port[] }
	return Array.isArray(body) ? body : body.items
}

function portNamed(ports: Port[], name: string): Port {
	const port = ports.find((row) => row.name === name)
	expect(port, `port ${name}`).toBeDefined()
	return port as Port
}

/** A cable from `portId` to a new device's only port; returns the cable and that port. */
async function cableToNewPeer(
	api: APIRequestContext,
	cleanup: Cleanup,
	portId: number,
	fields: object = {},
): Promise<{ cableId: number; peerPortId: number }> {
	const typeId = await createType(api, cleanup)
	await createStub(api, typeId, { prefix: 'peer' })
	const peerId = await createDevice(api, cleanup, typeId, fields)
	const peerPortId = portNamed(await portsOf(api, peerId), 'peer').id
	const cableId = await create(api, cleanup, 'cables', {
		a_interface_id: portId,
		b_interface_id: peerPortId,
	})
	return { cableId, peerPortId }
}

async function outOfSync(
	api: APIRequestContext,
	typeId: number,
	deviceId: number,
): Promise<boolean> {
	const res = await ok(
		await api.get(`/api/devices?device_type=${typeId}&kind=device&page=1&limit=200`),
	)
	const { items } = (await res.json()) as { items: { id: number; out_of_sync: boolean }[] }
	return items.find((row) => row.id === deviceId)?.out_of_sync ?? false
}

async function preview(api: APIRequestContext, deviceId: number): Promise<Preview> {
	return (await (
		await ok(await api.get(`/api/devices/${deviceId}/template-sync`))
	).json()) as Preview
}

/** Opens the sync dialog of the type's device from the device type page. */
async function openSync(page: Page, typeId: number): Promise<Locator> {
	await page.goto(`/device-types/${typeId}`)
	await page.getByRole('button', { name: 'Ports aus Gerätetyp aktualisieren' }).click()
	const dialog = page.getByRole('dialog')
	await expect(dialog.getByRole('button', { name: 'Aktualisieren', exact: true })).toBeEnabled()
	return dialog
}

async function applySync(dialog: Locator): Promise<void> {
	await dialog.getByRole('button', { name: 'Aktualisieren', exact: true }).click()
	await expect(dialog).toBeHidden()
}

test.describe('template sync', () => {
	test('a renamed stub keeps cables and port state on the same ports', async ({ page }) => {
		const api = page.request
		const cleanup = new Cleanup(api)
		try {
			const typeId = await createType(api, cleanup)
			const stubId = await createStub(api, typeId, { prefix: 'eth', count: 24 })
			const deviceId = await createDevice(api, cleanup, typeId)
			const before = await portsOf(api, deviceId)
			const cabled = portNamed(before, 'eth5')
			const disabled = portNamed(before, 'eth7')
			const { cableId, peerPortId } = await cableToNewPeer(api, cleanup, cabled.id)
			await ok(
				await api.patch(`/api/devices/${deviceId}/interfaces/${disabled.id}`, {
					data: { enabled: false },
				}),
			)

			await ok(
				await api.patch(`/api/device-types/${typeId}/stubs/${stubId}`, {
					data: { prefix: 'Gi' },
				}),
			)
			expect(await outOfSync(api, typeId, deviceId)).toBe(true)

			await applySync(await openSync(page, typeId))

			const after = await portsOf(api, deviceId)
			expect(after).toHaveLength(24)
			expect(after.map((port) => port.id).sort()).toEqual(
				before.map((port) => port.id).sort(),
			)
			expect(portNamed(after, 'Gi5').id).toBe(cabled.id)
			expect(portNamed(after, 'Gi5').connected).toBe(true)
			expect(portNamed(after, 'Gi7').id).toBe(disabled.id)
			expect(portNamed(after, 'Gi7').enabled).toBe(false)
			const cable = await ok(await api.get(`/api/cables/${cableId}`))
			expect(await cable.json()).toMatchObject({
				a_interface_id: cabled.id,
				b_interface_id: peerPortId,
			})
			expect(await outOfSync(api, typeId, deviceId)).toBe(false)
		} finally {
			await cleanup.run()
		}
	})

	test('ports with a room or floor plan position are kept unless removed explicitly', async ({
		page,
	}) => {
		const api = page.request
		const cleanup = new Cleanup(api)
		try {
			const siteId = await findId(api, 'sites', 'name', 'E2E Site')
			const locationId = await create(api, cleanup, 'locations', {
				name: unique('Room'),
				site_id: siteId,
			})
			const upload = await ok(
				await api.post('/api/attachments', {
					multipart: {
						location_id: String(locationId),
						file: { name: 'plan.png', mimeType: 'image/png', buffer: PLAN_PNG },
					},
				}),
			)
			const { id: planId } = (await upload.json()) as { id: number }
			cleanup.add(`attachments/${planId}?confirm=floorplan`)
			await ok(
				await api.patch(`/api/attachments/${planId}`, { data: { is_floorplan: true } }),
			)

			const typeId = await createType(api, cleanup)
			const stubIds = await Promise.all(
				['roomed', 'placed', 'bare', 'dropped'].map((prefix) =>
					createStub(api, typeId, { prefix, side: 'rear', kind: '8p8c' }),
				),
			)
			const deviceId = await createDevice(api, cleanup, typeId, {
				site_id: siteId,
				location_id: locationId,
			})
			const ports = await portsOf(api, deviceId)
			const roomed = portNamed(ports, 'roomed')
			const placed = portNamed(ports, 'placed')
			const dropped = portNamed(ports, 'dropped')
			for (const port of [roomed, dropped]) {
				await ok(
					await api.patch(`/api/devices/${deviceId}/interfaces/${port.id}`, {
						data: { location_id: locationId },
					}),
				)
			}
			await ok(
				await api.put(`/api/attachments/${planId}/plan`, {
					data: {
						areas: [],
						placements: [{ interface_id: placed.id, x: 0.5, y: 0.5 }],
					},
				}),
			)
			for (const stubId of stubIds) {
				await ok(await api.delete(`/api/device-types/${typeId}/stubs/${stubId}`))
			}

			const { orphaned } = await preview(api, deviceId)
			expect(Object.fromEntries(orphaned.map((port) => [port.name, port.located]))).toEqual({
				roomed: true,
				placed: true,
				bare: false,
				dropped: true,
			})

			const dialog = await openSync(page, typeId)
			const choice = (port: Port): Locator => dialog.locator(`#template-sync-${port.id}`)
			await expect(choice(roomed)).toHaveValue('Unverändert behalten')
			await expect(choice(placed)).toHaveValue('Unverändert behalten')
			await expect(choice(portNamed(ports, 'bare'))).toHaveValue('Entfernen')
			await expect(dialog.getByText('Entfernen löscht diese')).toHaveCount(3)

			// The warned port goes only when the user picks that.
			await choice(dropped).click()
			await page.getByRole('option', { name: 'Entfernen' }).click()
			await applySync(dialog)

			const after = await portsOf(api, deviceId)
			expect(after.map((port) => port.name).sort()).toEqual(['placed', 'roomed'])
			expect(portNamed(after, 'roomed').location_id).toBe(locationId)
			const plan = await ok(await api.get(`/api/attachments/${planId}/plan`))
			const { placements } = (await plan.json()) as {
				placements: { interface_id: number | null }[]
			}
			expect(placements.map((row) => row.interface_id)).toEqual([placed.id])
		} finally {
			await cleanup.run()
		}
	})

	test('a port renamed on the device stays linked to its template port', async ({ page }) => {
		const api = page.request
		const cleanup = new Cleanup(api)
		try {
			const typeId = await createType(api, cleanup)
			const stubId = await createStub(api, typeId, { prefix: 'eth', count: 4 })
			const deviceId = await createDevice(api, cleanup, typeId)
			const port = portNamed(await portsOf(api, deviceId), 'eth1')
			await cableToNewPeer(api, cleanup, port.id)
			const rename = (name: string): Promise<APIResponse> =>
				api.patch(`/api/devices/${deviceId}/interfaces/${port.id}`, { data: { name } })
			await ok(await rename('Uplink-Core'))

			// The type still describes the device: nothing to sync, no second port.
			expect(await outOfSync(api, typeId, deviceId)).toBe(false)

			// A template change reaches the port without touching its name.
			await ok(
				await api.patch(`/api/device-types/${typeId}/stubs/${stubId}`, {
					data: { description: 'Access port' },
				}),
			)
			expect((await preview(api, deviceId)).orphaned).toEqual([])
			await applySync(await openSync(page, typeId))
			const synced = portNamed(await portsOf(api, deviceId), 'Uplink-Core')
			expect(synced.id).toBe(port.id)
			expect(synced.connected).toBe(true)
			expect(synced.description).toBe('Access port')
			expect(await portsOf(api, deviceId)).toHaveLength(4)

			// Renaming the stub moves the link and keeps the custom name.
			await ok(
				await api.patch(`/api/device-types/${typeId}/stubs/${stubId}`, {
					data: { prefix: 'Gi' },
				}),
			)
			const dialog = await openSync(page, typeId)
			await expect(dialog.locator(`#template-sync-${port.id}`)).toHaveValue(
				/^Namen behalten, mit Gi1 verknüpfen/,
			)
			await applySync(dialog)
			const moved = await portsOf(api, deviceId)
			expect(moved.map((row) => row.name).sort()).toEqual([
				'Gi2',
				'Gi3',
				'Gi4',
				'Uplink-Core',
			])
			expect(portNamed(moved, 'Uplink-Core').template_name).toBe('Gi1')
			expect(await outOfSync(api, typeId, deviceId)).toBe(false)

			// Taking the template name back ends the link.
			await ok(await rename('Gi1'))
			expect(portNamed(await portsOf(api, deviceId), 'Gi1').template_name).toBeNull()
			expect(await outOfSync(api, typeId, deviceId)).toBe(false)
		} finally {
			await cleanup.run()
		}
	})

	test('a port with an older custom name can be linked instead of renamed', async ({ page }) => {
		const api = page.request
		const cleanup = new Cleanup(api)
		try {
			const typeId = await createType(api, cleanup)
			const stubId = await createStub(api, typeId, { prefix: 'eth', count: 2 })
			const deviceId = await createDevice(api, cleanup, typeId)
			const port = portNamed(await portsOf(api, deviceId), 'eth1')
			// Stands in for a rename from before links: the name differs, no link is set.
			await ok(
				await api.patch(`/api/device-types/${typeId}/stubs/${stubId}`, {
					data: { prefix: 'Gi' },
				}),
			)

			const dialog = await openSync(page, typeId)
			const choice = dialog.locator(`#template-sync-${port.id}`)
			await expect(choice).toHaveValue(/^Umbenennen in Gi1/)
			await choice.click()
			await page.getByRole('option', { name: /^Namen behalten, mit Gi1/ }).click()
			await applySync(dialog)

			const after = await portsOf(api, deviceId)
			expect(after).toHaveLength(2)
			expect(portNamed(after, 'eth1').template_name).toBe('Gi1')
			expect(await outOfSync(api, typeId, deviceId)).toBe(false)
		} finally {
			await cleanup.run()
		}
	})
})

test.describe('type edits with mounted devices', () => {
	/** A 10 U rack with its own rack type, so tests can resize it. */
	async function createRack(
		api: APIRequestContext,
		cleanup: Cleanup,
	): Promise<{ rackId: number; rackTypeId: number; siteId: number }> {
		const siteId = await findId(api, 'sites', 'name', 'E2E Site')
		const rackTypeId = await create(api, cleanup, 'rack-types', {
			manufacturer_id: await maker(api),
			model: unique('Rack Type'),
			u_height: 10,
			form_factor: '4-post cabinet',
		})
		const rackId = await create(api, cleanup, 'racks', {
			name: unique('Rack'),
			site_id: siteId,
			rack_type_id: rackTypeId,
		})
		return { rackId, rackTypeId, siteId }
	}

	async function expectRefused(
		api: APIRequestContext,
		path: string,
		patch: object,
		message: RegExp,
	): Promise<void> {
		const before = await (await ok(await api.get(`/api/${path}`))).json()
		const res = await api.patch(`/api/${path}`, { data: patch })
		expect(res.status(), await res.text()).toBe(409)
		expect(((await res.json()) as { error: string }).error).toMatch(message)
		expect(await (await ok(await api.get(`/api/${path}`))).json()).toEqual(before)
	}

	test('a height that overlaps, leaves the rack or is zero is refused', async ({ page }) => {
		const api = page.request
		const cleanup = new Cleanup(api)
		try {
			const { rackId, siteId } = await createRack(api, cleanup)
			const typeId = await createType(api, cleanup, { u_height: 1 })
			const mount = { rack_id: rackId, site_id: siteId, face: 'front' }
			await createDevice(api, cleanup, typeId, { ...mount, position_u: 1 })
			await createDevice(api, cleanup, typeId, { ...mount, position_u: 3 })
			await createDevice(api, cleanup, typeId, { ...mount, position_u: 10 })

			await expectRefused(api, `device-types/${typeId}`, { u_height: 3 }, /overlaps|U\d+/)
			await expectRefused(api, `device-types/${typeId}`, { u_height: 0 }, /0/)
		} finally {
			await cleanup.run()
		}
	})

	test('a height past the top of the rack is refused', async ({ page }) => {
		const api = page.request
		const cleanup = new Cleanup(api)
		try {
			const { rackId, siteId } = await createRack(api, cleanup)
			const typeId = await createType(api, cleanup, { u_height: 1 })
			await createDevice(api, cleanup, typeId, {
				rack_id: rackId,
				site_id: siteId,
				face: 'front',
				position_u: 10,
			})

			await expectRefused(api, `device-types/${typeId}`, { u_height: 2 }, /U|rack/i)
		} finally {
			await cleanup.run()
		}
	})

	test('full depth is refused while the other face is occupied', async ({ page }) => {
		const api = page.request
		const cleanup = new Cleanup(api)
		try {
			const { rackId, siteId } = await createRack(api, cleanup)
			const typeId = await createType(api, cleanup, { u_height: 1, is_full_depth: false })
			const mount = { rack_id: rackId, site_id: siteId, position_u: 5 }
			await createDevice(api, cleanup, typeId, { ...mount, face: 'front' })
			await createDevice(api, cleanup, typeId, { ...mount, face: 'rear' })

			await expectRefused(api, `device-types/${typeId}`, { is_full_depth: true }, /overlaps/)
		} finally {
			await cleanup.run()
		}
	})

	test('a rack type cannot shrink below a mounted device', async ({ page }) => {
		const api = page.request
		const cleanup = new Cleanup(api)
		try {
			const { rackId, rackTypeId, siteId } = await createRack(api, cleanup)
			const typeId = await createType(api, cleanup, { u_height: 1 })
			await createDevice(api, cleanup, typeId, {
				rack_id: rackId,
				site_id: siteId,
				face: 'front',
				position_u: 10,
			})

			await expectRefused(api, `rack-types/${rackTypeId}`, { u_height: 5 }, /U|rack/i)
		} finally {
			await cleanup.run()
		}
	})
})

test.describe('permissions', () => {
	const password = 'e2e-secret-123'

	/** Signs a new user with `permissions` in; `dispose` the returned context. */
	async function signIn(
		page: Page,
		playwright: { request: { newContext: (o: object) => Promise<APIRequestContext> } },
		baseURL: string | undefined,
		cleanup: Cleanup,
		permissions: string[],
		tenantId: number | null,
	): Promise<{ context: APIRequestContext; username: string }> {
		const api = page.request
		const roleId = await create(api, cleanup, 'roles', { name: unique('Role'), permissions })
		const name = `e2e-dt-${nextId()}`
		// Scoped accounts belong to an employee of their tenant and sign in
		// with its primary mail address.
		const username = tenantId === null ? name : `${name}@example.com`
		const employeeId =
			tenantId === null
				? null
				: await create(api, cleanup, 'employees', {
						last_name: name,
						tenant_ids: [tenantId],
						emails: [{ address: username, scope: 'work' }],
					})
		await create(api, cleanup, 'users', {
			...(employeeId === null ? { username } : {}),
			password,
			role_id: roleId,
			tenant_id: tenantId,
			employee_id: employeeId,
		})
		const context = await playwright.request.newContext({ baseURL })
		await ok(await context.post('/api/auth/login', { data: { username, password } }))
		return { context, username }
	}

	/** Every write on the shared catalog; each must answer 403 and change nothing. */
	async function expectCatalogLocked(
		context: APIRequestContext,
		typeId: number,
		stubId: number,
		manufacturerId: number,
	): Promise<void> {
		const yaml = `manufacturer: E2E Maker\nmodel: ${unique('Forbidden')}\n`
		const writes: [string, Promise<APIResponse>][] = [
			[
				'create type',
				context.post('/api/device-types', {
					data: { manufacturer_id: manufacturerId, model: unique('Forbidden') },
				}),
			],
			['import', context.post('/api/device-types/import', { data: { yaml } })],
			[
				'preview update',
				context.post(`/api/device-types/${typeId}/update-preview`, { data: { yaml } }),
			],
			[
				'apply update',
				context.post(`/api/device-types/${typeId}/update`, {
					data: { yaml, revision: 'any' },
				}),
			],
			['edit type', context.patch(`/api/device-types/${typeId}`, { data: { u_height: 2 } })],
			['delete type', context.delete(`/api/device-types/${typeId}`)],
			[
				'create stub',
				context.post(`/api/device-types/${typeId}/stubs`, { data: { prefix: 'nope' } }),
			],
			[
				'edit stub',
				context.patch(`/api/device-types/${typeId}/stubs/${stubId}`, {
					data: { prefix: 'nope' },
				}),
			],
			['delete stub', context.delete(`/api/device-types/${typeId}/stubs/${stubId}`)],
		]
		for (const [label, write] of writes) {
			expect((await write).status(), label).toBe(403)
		}
	}

	test('view-only users cannot change the catalog or sync, and see no sync button', async ({
		page,
		playwright,
		browser,
		baseURL,
	}) => {
		const api = page.request
		const cleanup = new Cleanup(api)
		let context: APIRequestContext | undefined
		try {
			const typeId = await createType(api, cleanup)
			const stubId = await createStub(api, typeId, { prefix: 'eth', count: 2 })
			const deviceId = await createDevice(api, cleanup, typeId)
			await ok(
				await api.patch(`/api/device-types/${typeId}/stubs/${stubId}`, {
					data: { prefix: 'Gi' },
				}),
			)
			const user = await signIn(page, playwright, baseURL, cleanup, ['view'], null)
			context = user.context

			await expectCatalogLocked(context, typeId, stubId, await maker(api))
			const sync = await context.post(`/api/devices/${deviceId}/template-sync`, {
				data: { assignments: [] },
			})
			expect(sync.status()).toBe(403)

			const viewer = await browser.newContext({
				baseURL,
				storageState: await context.storageState(),
			})
			const viewerPage = await viewer.newPage()
			await viewerPage.goto(`/device-types/${typeId}`)
			await expect(viewerPage.getByRole('link', { name: /E2E DT Device/ })).toBeVisible()
			await expect(
				viewerPage.getByRole('button', { name: 'Ports aus Gerätetyp aktualisieren' }),
			).toHaveCount(0)
			await viewer.close()
		} finally {
			await context?.dispose()
			await cleanup.run()
		}
	})

	test('tenant editors sync their own devices only and cannot change the catalog', async ({
		page,
		playwright,
		baseURL,
	}) => {
		const api = page.request
		const cleanup = new Cleanup(api)
		let context: APIRequestContext | undefined
		try {
			const ownTenant = await create(api, cleanup, 'tenants', { name: unique('Own') })
			const otherTenant = await create(api, cleanup, 'tenants', { name: unique('Other') })
			const typeId = await createType(api, cleanup)
			const stubId = await createStub(api, typeId, { prefix: 'eth', count: 2 })
			const ownId = await createDevice(api, cleanup, typeId, { tenant_id: ownTenant })
			const otherId = await createDevice(api, cleanup, typeId, { tenant_id: otherTenant })
			await createStub(api, typeId, { prefix: 'mgmt' })
			const user = await signIn(
				page,
				playwright,
				baseURL,
				cleanup,
				['view', 'edit', 'delete'],
				ownTenant,
			)
			context = user.context

			await expectCatalogLocked(context, typeId, stubId, await maker(api))

			for (const res of [
				await context.get(`/api/devices/${otherId}/template-sync`),
				await context.post(`/api/devices/${otherId}/template-sync`, {
					data: { assignments: [] },
				}),
			]) {
				expect(res.status()).toBe(403)
			}
			expect(await portsOf(api, otherId)).toHaveLength(2)

			const listed = await ok(
				await context.get(
					`/api/devices?device_type=${typeId}&kind=device&page=1&limit=200`,
				),
			)
			const { items } = (await listed.json()) as { items: { id: number }[] }
			expect(items.map((row) => row.id)).toEqual([ownId])

			await ok(
				await context.post(`/api/devices/${ownId}/template-sync`, {
					data: { assignments: [] },
				}),
			)
			expect(await portsOf(api, ownId)).toHaveLength(3)
		} finally {
			await context?.dispose()
			await cleanup.run()
		}
	})
})

test.describe('imported device types', () => {
	async function importYaml(page: Page, cleanup: Cleanup, yaml: string): Promise<number> {
		const res = await page.request.post('/api/device-types/import', { data: { yaml } })
		const body = (await res.json()) as { rows: { id: number | null; error: string | null }[] }
		const id = body.rows[0]?.id
		expect(id, JSON.stringify(body)).toBeTruthy()
		cleanup.add(`device-types/${id}`)
		return id as number
	}

	interface ImportResponse {
		created: number
		rows: { error: string | null }[]
	}

	interface Stub {
		id: number
		prefix: string
		count: number
		description: string | null
		positions: number
	}

	async function stubsOf(api: APIRequestContext, typeId: number): Promise<Stub[]> {
		return (await (
			await ok(await api.get(`/api/device-types/${typeId}/stubs`))
		).json()) as Stub[]
	}

	test('names outside the prefix rules stay editable and build a matching device', async ({
		page,
	}) => {
		const api = page.request
		const cleanup = new Cleanup(api)
		try {
			const typeId = await importYaml(
				page,
				cleanup,
				[
					'manufacturer: E2E Maker',
					`model: ${unique('Imported')}`,
					'interfaces:',
					'  - name: Gi1/0/[1-4]',
					'    type: 1000base-t',
					'  - name: Büro 1',
					'    type: 1000base-t',
					'',
				].join('\n'),
			)
			const stubs = await stubsOf(api, typeId)
			expect(stubs.map((stub) => [stub.prefix, stub.count]).sort()).toEqual([
				['Büro 1', 1],
				['Gi1/0/', 4],
			])

			for (const name of ['Gi1/0/', 'Büro 1']) {
				await page.goto(`/device-types/${typeId}`)
				await page.getByRole('button', { name: `${name} bearbeiten` }).click()
				const dialog = page.getByRole('dialog')
				await dialog.getByLabel('Beschreibung').fill(`Edited ${name}`)
				await dialog.getByRole('button', { name: 'Speichern' }).click()
				await expect(dialog).toBeHidden()
			}
			expect((await stubsOf(api, typeId)).map((stub) => stub.description).sort()).toEqual([
				'Edited Büro 1',
				'Edited Gi1/0/',
			])

			const deviceId = await createDevice(api, cleanup, typeId)
			expect((await portsOf(api, deviceId)).map((port) => port.name).sort()).toEqual([
				'Büro 1',
				'Gi1/0/1',
				'Gi1/0/2',
				'Gi1/0/3',
				'Gi1/0/4',
			])
			expect(await outOfSync(api, typeId, deviceId)).toBe(false)
		} finally {
			await cleanup.run()
		}
	})

	test('stubs beyond the API limits are refused and roll the import back', async ({ page }) => {
		const api = page.request
		const models = [unique('Long'), unique('Positions')]
		const definitions = [
			[
				`model: ${models[0]}`,
				'interfaces:',
				'  - name: eth0',
				'    type: 1000base-t',
				`    description: ${'x'.repeat(800)}`,
			],
			[
				`model: ${models[1]}`,
				'rear-ports:',
				'  - name: Trunk',
				'    type: 8p8c',
				'    positions: 2000',
			],
		]
		for (const [i, lines] of definitions.entries()) {
			const yaml = ['manufacturer: E2E Maker', ...lines, ''].join('\n')
			const res = await ok(await api.post('/api/device-types/import', { data: { yaml } }))
			const body = (await res.json()) as ImportResponse
			expect(body.created).toBe(0)
			expect(body.rows[0]?.error).toMatch(i === 0 ? /description/ : /positions/)
			const list = await api.get(
				`/api/device-types?search=${encodeURIComponent(models[i] ?? '')}&page=1&limit=200`,
			)
			expect(((await list.json()) as { items: unknown[] }).items).toEqual([])
		}
	})
})

test.describe('updates from YAML', () => {
	interface Change {
		field: string
		from: string | null
		to: string | null
	}

	interface PortRef {
		name: string
		side: 'front' | 'rear' | null
		kind: string
	}

	interface UpdatePreview {
		revision: string
		device_count: number
		fields: Change[]
		added_ports: PortRef[]
		removed_ports: PortRef[]
		changed_ports: (PortRef & { changes: Change[] })[]
		unchanged_ports: number
	}

	interface TypeRow {
		model: string
		u_height: number
		part_number: string | null
		spec_url: string | null
		eol_date: string | null
		description: string | null
	}

	const switchYaml = (model: string): string =>
		[
			'manufacturer: E2E Maker',
			`model: ${model}`,
			'u_height: 1',
			'is_full_depth: false',
			'default_device_role: E2E Role',
			'part_number: PN-1',
			'spec_url: https://example.com/spec',
			'eol_date: 2031-03-01',
			'description: Before',
			'interfaces:',
			'  - name: eth[1-3]',
			'    type: 1000base-t',
			'    description: Uplink',
			'    poe_mode: pse',
			'    poe_type: type2-ieee802.3at',
			'power-ports:',
			'  - name: psu',
			'    type: iec-60320-c14',
			'    maximum_draw: 60',
			'',
		].join('\n')

	const panelYaml = (model: string): string =>
		[
			'manufacturer: E2E Maker',
			`model: ${model}`,
			'rear-ports:',
			'  - name: Trunk',
			'    type: mpo',
			'    positions: 2',
			'front-ports:',
			'  - name: Trunk',
			'    type: lc',
			'  - name: B',
			'    type: lc',
			'port-mappings:',
			'  - front_port: Trunk',
			'    front_port_position: 1',
			'    rear_port: Trunk',
			'    rear_port_position: 1',
			'  - front_port: B',
			'    front_port_position: 1',
			'    rear_port: Trunk',
			'    rear_port_position: 2',
			'',
		].join('\n')

	async function importType(
		api: APIRequestContext,
		cleanup: Cleanup,
		yaml: string,
	): Promise<number> {
		const res = await ok(await api.post('/api/device-types/import', { data: { yaml } }))
		const body = (await res.json()) as { rows: { id: number | null; error: string | null }[] }
		const id = body.rows[0]?.id
		expect(id, JSON.stringify(body)).toBeTruthy()
		cleanup.add(`device-types/${id}`)
		return id as number
	}

	async function exported(api: APIRequestContext, typeId: number): Promise<string> {
		const res = await ok(await api.get(`/api/device-types/${typeId}/yaml`))
		return ((await res.json()) as { yaml: string }).yaml
	}

	async function previewUpdate(
		api: APIRequestContext,
		typeId: number,
		yaml: string,
	): Promise<UpdatePreview> {
		const res = await ok(
			await api.post(`/api/device-types/${typeId}/update-preview`, { data: { yaml } }),
		)
		return (await res.json()) as UpdatePreview
	}

	interface StubRow {
		prefix: string
		side: 'front' | 'rear' | null
		description: string | null
		poe_mode: string | null
		poe_type: string | null
		rear_position: number
	}

	async function stubRows(api: APIRequestContext, typeId: number): Promise<StubRow[]> {
		const res = await ok(await api.get(`/api/device-types/${typeId}/stubs`))
		return (await res.json()) as StubRow[]
	}

	async function typeOf(api: APIRequestContext, typeId: number): Promise<TypeRow> {
		return (await (await ok(await api.get(`/api/device-types/${typeId}`))).json()) as TypeRow
	}

	const noChange = {
		fields: [],
		added_ports: [],
		removed_ports: [],
		changed_ports: [],
	}

	test('the export imports back as the same type and previews no change', async ({ page }) => {
		const api = page.request
		const cleanup = new Cleanup(api)
		try {
			for (const build of [switchYaml, panelYaml]) {
				const model = unique('Round')
				const typeId = await importType(api, cleanup, build(model))
				const yaml = await exported(api, typeId)
				expect(await previewUpdate(api, typeId, yaml)).toMatchObject(noChange)

				const copy = unique('Copy')
				const copyId = await importType(api, cleanup, yaml.replace(model, copy))
				expect(await exported(api, copyId)).toBe(yaml.replace(model, copy))
			}
		} finally {
			await cleanup.run()
		}
	})

	test('an omitted key keeps its value, null clears it and a dropped port goes', async ({
		page,
	}) => {
		const api = page.request
		const cleanup = new Cleanup(api)
		try {
			const model = unique('Merge')
			const typeId = await importType(api, cleanup, switchYaml(model))
			const before = await exported(api, typeId)
			const yaml = [
				'description: After',
				'spec_url: null',
				'eol_date: 2032-01-01',
				'interfaces:',
				'  - name: eth1',
				'  - name: eth2',
				'    description: Changed',
				'  - name: mgmt',
				'    type: 10gbase-t',
				'',
			].join('\n')

			const planned = await previewUpdate(api, typeId, yaml)
			expect(planned.fields.map((change) => change.field).sort()).toEqual([
				'description',
				'eol_date',
				'spec_url',
			])
			expect(planned.fields.find((change) => change.field === 'spec_url')?.to).toBeNull()
			expect(planned.added_ports.map((port) => port.name)).toEqual(['mgmt'])
			expect(planned.removed_ports.map((port) => port.name)).toEqual(['eth3'])
			expect(planned.changed_ports.map((port) => port.name)).toEqual(['eth2'])
			// eth1 and the untouched power port.
			expect(planned.unchanged_ports).toBe(2)
			expect(await exported(api, typeId)).toBe(before)

			await ok(
				await api.post(`/api/device-types/${typeId}/update`, {
					data: { yaml, revision: planned.revision },
				}),
			)
			expect(await typeOf(api, typeId)).toMatchObject({
				model,
				description: 'After',
				part_number: 'PN-1',
				spec_url: null,
				eol_date: '2032-01-01',
			})
			const after = await stubRows(api, typeId)
			expect(after.find((stub) => stub.prefix === 'eth1')).toMatchObject({
				description: 'Uplink',
				poe_mode: 'pse',
				poe_type: 'type2-ieee802.3at',
			})
			expect(after.find((stub) => stub.prefix === 'eth2')).toMatchObject({
				description: 'Changed',
				poe_mode: 'pse',
			})
			expect(after.map((stub) => stub.prefix).sort()).toEqual(['eth1', 'eth2', 'mgmt', 'psu'])
		} finally {
			await cleanup.run()
		}
	})

	test('a pass-through port can be remapped, and a clash leaves the type alone', async ({
		page,
	}) => {
		const api = page.request
		const cleanup = new Cleanup(api)
		try {
			const typeId = await importType(api, cleanup, panelYaml(unique('Panel')))
			const before = await exported(api, typeId)
			const clash = await api.post(`/api/device-types/${typeId}/update-preview`, {
				data: {
					yaml: [
						'port-mappings:',
						'  - front_port: B',
						'    front_port_position: 1',
						'    rear_port: Trunk',
						'    rear_port_position: 1',
						'',
					].join('\n'),
				},
			})
			expect(clash.ok()).toBe(false)
			expect(await exported(api, typeId)).toBe(before)

			const yaml = [
				'port-mappings:',
				'  - front_port: Trunk',
				'    front_port_position: 1',
				'    rear_port: Trunk',
				'    rear_port_position: 2',
				'  - front_port: B',
				'    front_port_position: 1',
				'    rear_port: Trunk',
				'    rear_port_position: 1',
				'',
			].join('\n')
			const planned = await previewUpdate(api, typeId, yaml)
			expect(planned.changed_ports.map((port) => [port.name, port.side]).sort()).toEqual([
				['B', 'front'],
				['Trunk', 'front'],
			])
			await ok(
				await api.post(`/api/device-types/${typeId}/update`, {
					data: { yaml, revision: planned.revision },
				}),
			)
			const fronts = (await stubRows(api, typeId)).filter((stub) => stub.side === 'front')
			expect(fronts.map((stub) => [stub.prefix, stub.rear_position]).sort()).toEqual([
				['B', 1],
				['Trunk', 2],
			])
		} finally {
			await cleanup.run()
		}
	})

	test('a type that changed since the preview is refused', async ({ page }) => {
		const api = page.request
		const cleanup = new Cleanup(api)
		try {
			const typeId = await importType(api, cleanup, switchYaml(unique('Stale')))
			const yaml = 'description: From the preview\n'
			const { revision } = await previewUpdate(api, typeId, yaml)
			await ok(
				await api.patch(`/api/device-types/${typeId}`, { data: { description: 'Edited' } }),
			)

			const res = await api.post(`/api/device-types/${typeId}/update`, {
				data: { yaml, revision },
			})
			expect(res.status()).toBe(409)
			expect((await typeOf(api, typeId)).description).toBe('Edited')
		} finally {
			await cleanup.run()
		}
	})

	test('unusable YAML is refused and writes nothing', async ({ page }) => {
		const api = page.request
		const cleanup = new Cleanup(api)
		try {
			const typeId = await importType(api, cleanup, switchYaml(unique('Refused')))
			const before = await exported(api, typeId)
			const cases: [string, RegExp][] = [
				['key: [', /Invalid YAML/],
				['- a\n- b\n', /exactly one device type/],
				['manufacturer: E2E Nobody\n', /Unknown manufacturer/],
				['default_device_role: E2E Nobody\n', /Unknown default_device_role/],
				['eol_date: 2031-02-30\n', /date/i],
				['u_height: 61\n', /u_height/],
				['interfaces:\n  - name: eth1\n    type: nope\n', /type must be one of/],
				['interfaces:\n  - name: a\n    poe_type: type1-ieee802.3af\n', /PoE/],
			]
			for (const [yaml, message] of cases) {
				const res = await api.post(`/api/device-types/${typeId}/update-preview`, {
					data: { yaml },
				})
				expect(res.ok(), yaml).toBe(false)
				expect(await res.text(), yaml).toMatch(message)
			}
			expect(await exported(api, typeId)).toBe(before)
		} finally {
			await cleanup.run()
		}
	})
})
