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

async function createDeviceWithPort(
	page: Page,
	name: string,
	typeId: number,
	roleId: number,
): Promise<number> {
	const created = await page.request.post('/api/devices', {
		data: { device_type_id: typeId, device_role_id: roleId, name },
	})
	expect(created.ok()).toBeTruthy()
	const { id } = (await created.json()) as { id: number }
	const port = await page.request.post(`/api/devices/${id}/interfaces`, {
		data: { name: 'eth0' },
	})
	expect(port.ok()).toBeTruthy()
	return id
}

test('connect dialog focuses the search on open and the port filter after picking a device', async ({
	page,
}) => {
	const suffix = Date.now()
	const localName = `E2E Connect Local ${suffix}`
	const peerName = `E2E Connect Peer ${suffix}`
	const typeId = await findId(page, 'device-types', 'model', 'E2E 1U Switch')
	const roleId = await findId(page, 'device-roles', 'name', 'E2E Role')
	const localId = await createDeviceWithPort(page, localName, typeId, roleId)
	const peerId = await createDeviceWithPort(page, peerName, typeId, roleId)
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
