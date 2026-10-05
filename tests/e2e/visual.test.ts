import { expect, test } from '@playwright/test'
import { stabilizeForSnapshot } from './helpers'

// Screenshot suite at 1920x1080 to catch layout regressions.
// Regenerate baselines: `bun run test:visual:update` (review PNGs in git).
// Auth comes from `auth.setup.ts` storageState — no per-test login.

test('rack detail and elevation layout', async ({ page }) => {
	const rackListResponse = await page.request.get(
		'/api/racks?search=E2E%20Visual%20Rack&page=1&limit=200',
	)
	expect(rackListResponse.ok()).toBeTruthy()
	const rackList = (await rackListResponse.json()) as {
		items: { id: number; name: string }[]
	}
	const rackId = rackList.items.find((rack) => rack.name === 'E2E Visual Rack')?.id
	expect(rackId).toBeDefined()
	await page.goto('/racks')
	await page.locator(`a[href="/racks/${rackId}"]`).click()
	await expect(page.getByTestId('rack-detail-title')).toBeVisible()
	await expect(page.getByTestId('rack-utilization')).toBeVisible()
	await expect(page.getByTestId('rack-elevation')).toBeVisible()
	await expect(page.getByTestId('rack-elevation').locator('.rack-elev')).toHaveCount(2)
	await stabilizeForSnapshot(page)
	await expect(page.locator('main.app-content')).toHaveScreenshot('rack-detail-and-elevation.png')
})

test('device type edit form layout', async ({ page }) => {
	const deviceTypesResponse = await page.request.get(
		'/api/device-types?search=E2E%2042U%20Cabinet&limit=200&kind=rack',
	)
	expect(deviceTypesResponse.ok()).toBeTruthy()
	const deviceTypes = (await deviceTypesResponse.json()) as {
		items: { id: number; model: string }[]
	}
	const deviceTypeId = deviceTypes.items.find(
		(deviceType) => deviceType.model === 'E2E 42U Cabinet',
	)?.id
	expect(deviceTypeId).toBeDefined()

	await page.goto(`/device-types/${deviceTypeId}/edit`)
	await expect(page.locator('#device-type-edit-full-depth')).toBeVisible()
	await expect(page.locator('#device-type-edit-model')).toHaveValue('E2E 42U Cabinet')
	await stabilizeForSnapshot(page)
	await expect(page.locator('main.app-content')).toHaveScreenshot('device-type-edit-form.png')
})

test('locations list layout', async ({ page }) => {
	await page.goto('/locations')
	await expect(page.locator('main.app-content h2')).toBeVisible()
	await expect(page.locator('main.app-content .skeleton')).toHaveCount(0)
	await stabilizeForSnapshot(page)
	await expect(page).toHaveScreenshot('locations-list.png', {
		fullPage: true,
		mask: [page.locator('.app-user-username')],
		maskColor: '#242424',
	})
})

test('device add form layout', async ({ page }) => {
	await page.goto('/devices/add')
	await expect(page.locator('#device-name')).toBeVisible()
	await expect(page.locator('.form-section-title')).toHaveCount(2)
	await stabilizeForSnapshot(page)
	await expect(page.locator('main.app-content')).toHaveScreenshot('device-add-form.png')
})
