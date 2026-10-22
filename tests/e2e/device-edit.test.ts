import { expect, type Page, test } from '@playwright/test'

// Auth comes from `auth.setup.ts` storageState — no per-test login.

async function findId(page: Page, path: string, key: string, value: string): Promise<number> {
	const sep = path.includes('?') ? '&' : '?'
	const res = await page.request.get(
		`/api/${path}${sep}search=${encodeURIComponent(value)}&page=1&limit=200`,
	)
	expect(res.ok()).toBeTruthy()
	const body = (await res.json()) as { items: ({ id: number } & Record<string, unknown>)[] }
	const match = body.items.find((item) => item[key] === value)
	expect(match, `${path} "${value}" is seeded`).toBeDefined()
	return match?.id ?? 0
}

async function post(page: Page, path: string, data: object): Promise<number> {
	const res = await page.request.post(`/api/${path}`, { data })
	expect(res.ok()).toBeTruthy()
	return ((await res.json()) as { id: number }).id
}

test('device edit only offers the sites, locations and racks of its tenant', async ({ page }) => {
	const suffix = Date.now()
	const typeId = await findId(page, 'device-types', 'model', 'E2E 1U Switch')
	const rackTypeId = await findId(page, 'device-types?kind=rack', 'model', 'E2E 10U Cabinet')
	const roleId = await findId(page, 'device-roles', 'name', 'E2E Role')
	const tenantId = await post(page, 'tenants', { name: `E2E Edit Tenant ${suffix}` })
	const otherId = await post(page, 'tenants', { name: `E2E Edit Other ${suffix}` })

	const ownSite = `E2E Edit Own Site ${suffix}`
	const otherSite = `E2E Edit Other Site ${suffix}`
	const ownSiteId = await post(page, 'sites', { name: ownSite, tenant_id: tenantId })
	const otherSiteId = await post(page, 'sites', { name: otherSite, tenant_id: otherId })

	const ownLocation = `E2E Edit Own Location ${suffix}`
	const otherLocation = `E2E Edit Other Location ${suffix}`
	const ownLocationId = await post(page, 'locations', {
		name: ownLocation,
		site_id: ownSiteId,
		tenant_id: tenantId,
	})
	const otherLocationId = await post(page, 'locations', {
		name: otherLocation,
		site_id: ownSiteId,
		tenant_id: otherId,
	})

	const ownRack = `E2E Edit Own Rack ${suffix}`
	const otherRack = `E2E Edit Other Rack ${suffix}`
	const ownRackId = await post(page, 'racks', {
		name: ownRack,
		site_id: ownSiteId,
		rack_type_id: rackTypeId,
		tenant_id: tenantId,
	})
	const otherRackId = await post(page, 'racks', {
		name: otherRack,
		site_id: ownSiteId,
		rack_type_id: rackTypeId,
		tenant_id: otherId,
	})

	const deviceId = await post(page, 'devices', {
		device_type_id: typeId,
		device_role_id: roleId,
		name: `E2E Edit Device ${suffix}`,
		tenant_id: tenantId,
	})
	try {
		await page.goto(`/devices/${deviceId}/edit`)

		await page.locator('#device-edit-site').click()
		await expect(page.getByRole('option', { name: ownSite })).toHaveCount(1)
		await expect(page.getByRole('option', { name: otherSite })).toHaveCount(0)
		await page.getByRole('option', { name: ownSite }).click()

		await page.locator('#device-edit-location').click()
		await expect(page.getByRole('option', { name: ownLocation })).toHaveCount(1)
		await expect(page.getByRole('option', { name: otherLocation })).toHaveCount(0)
		await page.keyboard.press('Escape')

		await page.locator('#device-edit-rack').click()
		await expect(page.getByRole('option', { name: ownRack })).toHaveCount(1)
		await expect(page.getByRole('option', { name: otherRack })).toHaveCount(0)
	} finally {
		await page.request.delete(`/api/devices/${deviceId}`)
		for (const id of [ownRackId, otherRackId]) {
			await page.request.delete(`/api/racks/${id}`)
		}
		for (const id of [ownLocationId, otherLocationId]) {
			await page.request.delete(`/api/locations/${id}`)
		}
		for (const id of [ownSiteId, otherSiteId]) {
			await page.request.delete(`/api/sites/${id}`)
		}
		for (const id of [tenantId, otherId]) {
			await page.request.delete(`/api/tenants/${id}`)
		}
	}
})
