import { expect, type Page, test } from '@playwright/test'

// Auth comes from `auth.setup.ts` storageState — no per-test login.

/** Opens the device-role add form from the device add form via the role dropdown's add entry. */
async function openRolePopup(page: Page): Promise<Page> {
	await page.locator('#device-role').click()
	const popupPromise = page.waitForEvent('popup')
	await page.locator('#device-role-listbox .combobox-option-add').click()
	const popup = await popupPromise
	await expect(popup).toHaveURL(/\/device-roles\/add/)
	await expect(popup.locator('#device-role-name')).toBeVisible()
	return popup
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

test('saving a device role opened from device add closes the popup and keeps the opener', async ({
	page,
}) => {
	const roleName = `E2E Nested Role ${Date.now()}`
	try {
		await page.goto('/devices/add')
		await page.locator('#device-name').fill('Nested Opener Device')
		const popup = await openRolePopup(page)

		await popup.locator('#device-role-name').fill(roleName)
		const closed = popup.waitForEvent('close')
		await popup.locator('#main .form-actions button[value="create"]').click()
		await closed

		// Still on the opener with its typed input; the popup saved and closed.
		await expect(page).toHaveURL(/\/devices\/add$/)
		await expect(page.locator('#device-name')).toHaveValue('Nested Opener Device')
	} finally {
		await deleteDeviceRoleByName(page, roleName)
	}
})

test('a device role added from the dropdown starts with the typed name and is listed on return', async ({
	page,
}) => {
	const roleName = `E2E Typed Role ${Date.now()}`
	try {
		await page.goto('/devices/add')
		await page.locator('#device-role').click()
		await page.locator('#device-role').fill(roleName)
		const popupPromise = page.waitForEvent('popup')
		await page.locator('#device-role-listbox .combobox-option-add').click()
		const popup = await popupPromise

		await expect(popup).toHaveURL(/\/device-roles\/add\?name=/)
		await expect(popup.locator('#device-role-name')).toHaveValue(roleName)
		const closed = popup.waitForEvent('close')
		await popup.locator('#main .form-actions button[value="create"]').click()
		await closed

		await expect(page).toHaveURL(/\/devices\/add$/)
		// The opener loaded its roles before this one existed; reopening the
		// dropdown refetches them.
		await page.locator('#device-role').click()
		await page.locator('#device-role').fill(roleName)
		await expect(
			page
				.locator('#device-role-listbox .combobox-option:not(.combobox-option-add)', {
					hasText: roleName,
				})
				.first(),
		).toBeVisible()
	} finally {
		await deleteDeviceRoleByName(page, roleName)
	}
})

test('cancelling a device role opened from device add closes the popup and keeps the opener', async ({
	page,
}) => {
	await page.goto('/devices/add')
	await page.locator('#device-name').fill('Nested Opener Device')
	const popup = await openRolePopup(page)

	const closed = popup.waitForEvent('close')
	await popup.locator('#main .form-actions > button').first().click()
	await closed

	await expect(page).toHaveURL(/\/devices\/add$/)
	await expect(page.locator('#device-name')).toHaveValue('Nested Opener Device')
})
