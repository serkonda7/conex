import { expect, type Page, test } from '@playwright/test'

// Auth comes from `auth.setup.ts` storageState — no per-test login.

/** The active tab's pane; inactive tabs stay mounted but hidden, so form
 * actions must be scoped here to avoid hitting a background tab. */
function activePane(page: Page): ReturnType<Page['locator']> {
	return page.locator('.tab-pane:not([hidden])')
}
/** Opens the device-role add tab from the device add form via the "+" button. */
async function openDeviceRoleAdd(page: Page, openerName: string): Promise<void> {
	await page.goto('/devices/add')
	await expect(page.locator('#device-name')).toBeVisible()
	await page.locator('#device-name').fill(openerName)
	await page.locator('div.field:has(#device-role) button').click()
	await expect(page).toHaveURL(/\/device-roles\/add/)
	await expect(page.locator('#device-role-name')).toBeVisible()
}

async function deleteDeviceRoleByName(page: Page, name: string): Promise<void> {
	const list = await page.request.get(
		`/api/device-roles?search=${encodeURIComponent(name)}&page=1&limit=200`,
	)
	if (!list.ok()) {
		return
	}
	const body = (await list.json()) as { items?: { id: number; name: string }[] }
	const match = body.items?.find((item) => item.name === name)
	if (match) {
		await page.request.delete(`/api/device-roles/${match.id}`)
	}
}

test('saving a device role opened from device add returns to the opener', async ({ page }) => {
	const roleName = `E2E Nested Role ${Date.now()}`
	try {
		await openDeviceRoleAdd(page, 'Nested Opener Device')
		// Two tabs: the device add opener and the nested role add.
		await expect(page.locator('[data-tab-button]')).toHaveCount(2)

		await page.locator('#device-role-name').fill(roleName)
		await activePane(page).locator('.form-actions button[value="create"]').click()

		// Back on the opener, not the role list; typed input is kept.
		await expect(page).toHaveURL(/\/devices\/add/)
		await expect(page.locator('#device-name')).toHaveValue('Nested Opener Device')
		await expect(page.locator('[data-tab-button]')).toHaveCount(1)
	} finally {
		await deleteDeviceRoleByName(page, roleName)
	}
})

test('cancelling a device role opened from device add returns to the opener', async ({ page }) => {
	await openDeviceRoleAdd(page, 'Nested Opener Device')
	await activePane(page).locator('.form-actions > button').first().click()

	await expect(page).toHaveURL(/\/devices\/add/)
	await expect(page.locator('#device-name')).toHaveValue('Nested Opener Device')
	await expect(page.locator('[data-tab-button]')).toHaveCount(1)
})
