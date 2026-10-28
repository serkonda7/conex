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

	// A saved desktop icon rail must not hide labels or shortcuts on mobile.
	await page.getByRole('button', { name: 'Seitenleiste einklappen', exact: true }).click()
	await page.setViewportSize({ width: 390, height: 844 })
	const menu = page.getByRole('button', { name: 'Navigation öffnen', exact: true })
	const drawer = page.getByRole('dialog', { name: 'Hauptnavigation', exact: true })
	await expect(menu).toHaveAttribute('aria-expanded', 'false')
	await expect(page.locator('.app-sidebar')).toBeHidden()

	await menu.click()
	await expect(drawer).toBeVisible()
	await expect(drawer.locator('a[href="/devices"] .app-nav-text')).toBeVisible()
	await expect(
		page.getByRole('button', { name: 'Navigation schließen', exact: true }),
	).toBeFocused()
	await page.keyboard.press('Tab')
	await expect(drawer.locator('a[href="/dashboard"]')).toBeFocused()
	await page.keyboard.press('Escape')
	await expect(drawer).toBeHidden()
	await expect(menu).toBeFocused()

	await menu.click()
	await page.mouse.click(385, 400)
	await expect(drawer).toBeHidden()

	// The header and context popover also fit narrow phones without wrapping controls.
	await page.setViewportSize({ width: 320, height: 640 })
	const context = page.getByRole('button', { name: /^Mandantenkontext:/ })
	await context.click()
	const popover = await page.locator('.app-tenant-context-popover').boundingBox()
	expect(popover).not.toBeNull()
	expect(popover?.x).toBeGreaterThanOrEqual(0)
	expect((popover?.x ?? 0) + (popover?.width ?? 0)).toBeLessThanOrEqual(320)
	const headerFits = await page.locator('.app-topbar').evaluate((header) =>
		Array.from(header.children).every((child) => {
			const box = child.getBoundingClientRect()
			return box.left >= 0 && box.right <= window.innerWidth
		}),
	)
	expect(headerFits).toBe(true)
	await context.click()

	await menu.click()
	await drawer
		.locator('.app-nav-item:has(> a[href="/devices"]) button.app-nav-add')
		.first()
		.click()
	await expect(page).toHaveURL(/\/devices\/add$/)
	await expect(drawer).toBeHidden()
	await expect(menu).toHaveAttribute('aria-expanded', 'false')
	await page.locator('.tab-pane:not([hidden]) .form-actions > button').first().click()
	await expect(page).toHaveURL(new RegExp(`${detailPath}$`))
	await expect(page.locator('[data-tab-button]')).toHaveCount(1)

	await menu.click()
	await drawer.locator('a[href="/devices"]').click()
	await expect(page).toHaveURL(/\/devices$/)
	await expect(drawer).toBeHidden()

	await menu.click()
	await page.setViewportSize({ width: 1920, height: 1080 })
	await expect(page.locator('.app-sidebar')).toHaveClass(/collapsed/)
	await expect(page.locator('body')).not.toHaveCSS('overflow', 'hidden')
	await page.getByRole('button', { name: 'Seitenleiste ausklappen', exact: true }).click()
})
