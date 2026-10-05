import { expect, test } from '@playwright/test'

// Auth comes from `auth.setup.ts` storageState — no per-test login.

test('cancelling device add from the navbar returns to the device detail', async ({ page }) => {
	const list = await page.request.get('/api/devices?search=E2E%20Spare%20Device&page=1&limit=200')
	expect(list.ok()).toBe(true)
	const body = (await list.json()) as { items: { id: number; name: string }[] }
	const device = body.items.find((item) => item.name === 'E2E Spare Device')
	expect(device).toBeDefined()
	const detailPath = `/devices/${device?.id}`

	await page.goto(detailPath)
	await expect(page.locator('.tab-pane:not([hidden])')).toContainText('E2E Spare Device')

	await page.locator('.app-nav-item:has(> a[href="/devices"]) button.app-nav-add').first().click()
	await expect(page).toHaveURL(/\/devices\/add$/)
	await expect(page.locator('[data-tab-button]')).toHaveCount(2)

	await page.locator('.tab-pane:not([hidden]) .form-actions > button').first().click()

	await expect(page).toHaveURL(new RegExp(`${detailPath}$`))
	await expect(page.locator('[data-tab-button]')).toHaveCount(1)
})
