import { expect, type Page, test } from '@playwright/test'

// Auth comes from `auth.setup.ts` storageState — no per-test login.

async function findId(page: Page, path: string, key: string, value: string): Promise<number> {
	const res = await page.request.get(
		`/api/${path}?search=${encodeURIComponent(value)}&page=1&limit=200`,
	)
	expect(res.ok()).toBeTruthy()
	const body = (await res.json()) as { items: ({ id: number } & Record<string, unknown>)[] }
	const match = body.items.find((item) => item[key] === value)
	expect(match, `${path} "${value}" is seeded`).toBeDefined()
	return match?.id ?? 0
}

/** Creates a device with one `eth0` port; returns the device and port ids. */
async function createDeviceWithPort(
	page: Page,
	name: string,
	typeId: number,
	roleId: number,
	options: { kind?: string; tenantId?: number } = {},
): Promise<{ id: number; portId: number }> {
	const created = await page.request.post('/api/devices', {
		data: {
			device_type_id: typeId,
			device_role_id: roleId,
			name,
			tenant_id: options.tenantId ?? null,
		},
	})
	expect(created.ok()).toBeTruthy()
	const { id } = (await created.json()) as { id: number }
	const port = await page.request.post(`/api/devices/${id}/interfaces`, {
		data: { name: 'eth0', kind: options.kind ?? 'ethernet' },
	})
	expect(port.ok()).toBeTruthy()
	const { id: portId } = (await port.json()) as { id: number }
	return { id, portId }
}

test('connect dialog focuses the search on open and the port filter after picking a device', async ({
	page,
}) => {
	const suffix = Date.now()
	const localName = `E2E Connect Local ${suffix}`
	const peerName = `E2E Connect Peer ${suffix}`
	const typeId = await findId(page, 'device-types', 'model', 'E2E 1U Switch')
	const roleId = await findId(page, 'device-roles', 'name', 'E2E Role')
	const { id: localId } = await createDeviceWithPort(page, localName, typeId, roleId)
	const { id: peerId } = await createDeviceWithPort(page, peerName, typeId, roleId)
	try {
		await page.goto(`/devices/${localId}`)
		await page.getByRole('button', { name: 'Kabel für eth0 verbinden' }).click()

		const dialog = page.getByRole('dialog')
		await expect(dialog).toBeVisible()
		await expect(dialog.getByRole('textbox')).toBeFocused()

		await dialog.getByRole('textbox').fill(peerName)
		await dialog.getByRole('button', { name: new RegExp(peerName) }).click()

		await expect(dialog.getByRole('textbox', { name: 'Anschlüsse filtern…' })).toBeFocused()

		// Going back to the device step focuses its search again.
		await dialog.getByRole('button', { name: 'Gerät ändern' }).click()
		await expect(dialog.getByRole('textbox')).toBeFocused()
	} finally {
		await page.request.delete(`/api/devices/${peerId}`)
		await page.request.delete(`/api/devices/${localId}`)
	}
})

test('connect dialog only lists devices of the same tenant with a compatible port', async ({
	page,
}) => {
	const suffix = Date.now()
	const typeId = await findId(page, 'device-types', 'model', 'E2E 1U Switch')
	const roleId = await findId(page, 'device-roles', 'name', 'E2E Role')
	const tenant = await page.request.post('/api/tenants', {
		data: { name: `E2E Connect Tenant ${suffix}` },
	})
	expect(tenant.ok()).toBeTruthy()
	const { id: tenantId } = (await tenant.json()) as { id: number }
	const local = await createDeviceWithPort(page, `E2E Connect Local ${suffix}`, typeId, roleId)
	const peerName = `E2E Connect Peer ${suffix}`
	const peer = await createDeviceWithPort(page, peerName, typeId, roleId)
	const power = await createDeviceWithPort(page, `E2E Connect Power ${suffix}`, typeId, roleId, {
		kind: 'power',
	})
	const foreign = await createDeviceWithPort(
		page,
		`E2E Connect Foreign ${suffix}`,
		typeId,
		roleId,
		{ tenantId },
	)
	try {
		await page.goto(`/devices/${local.id}`)
		await page.getByRole('button', { name: 'Kabel für eth0 verbinden' }).click()
		const dialog = page.getByRole('dialog')
		await dialog.getByRole('textbox').fill(String(suffix))

		// Left out: the power-only device, the other tenant's device and the
		// local device (no other port).
		await expect(dialog.locator('.object-selector-label')).toHaveText([peerName])

		// Cables never cross tenants, not even through the API.
		const crossTenant = await page.request.post('/api/cables', {
			data: { a_interface_id: local.portId, b_interface_id: foreign.portId },
		})
		expect(crossTenant.status()).toBe(409)
	} finally {
		for (const device of [foreign, power, peer, local]) {
			await page.request.delete(`/api/devices/${device.id}`)
		}
		await page.request.delete(`/api/tenants/${tenantId}`)
	}
})
