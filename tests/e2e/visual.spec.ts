import { expect, test } from '@playwright/test'
import { loginAsE2E, stabilizeForSnapshot } from './helpers'

// Screenshot suite at 1920x1080 to catch layout regressions.
// Regenerate baselines: `bun run test:visual:update` (review PNGs in git).

test('device type add form layout', async ({ page }) => {
	await loginAsE2E(page)
	await page.goto('/device-types/add')
	await expect(page.getByRole('heading', { name: 'Add a device type' })).toBeVisible()
	await stabilizeForSnapshot(page)
	await expect(page).toHaveScreenshot('device-type-add-form.png')
})

test('rack detail and elevation layout', async ({ page }) => {
	await loginAsE2E(page)
	await page.goto('/racks')
	await page.getByRole('link', { name: 'E2E Visual Rack' }).click()
	await expect(page.getByRole('heading', { name: 'E2E Visual Rack 10U' })).toBeVisible()
	await expect(page.getByRole('link', { name: 'E2E Edge Server' }).first()).toBeVisible()
	await expect(page.getByRole('link', { name: 'E2E Rack Switch' }).first()).toBeVisible()
	await expect(page.getByRole('link', { name: 'E2E Spare Device' })).toBeVisible()
	await expect(page.getByRole('status', { name: '3 of 10U used' })).toBeVisible()
	await stabilizeForSnapshot(page)
	await expect(page).toHaveScreenshot('rack-detail-and-elevation.png')
})
