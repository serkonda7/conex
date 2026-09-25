import { expect, test } from '@playwright/test'
import { stabilizeForSnapshot } from './helpers'

// Screenshot suite at 1920x1080 to catch layout regressions.
// Regenerate baselines: `bun run test:visual:update` (review PNGs in git).
// Auth comes from `auth.setup.ts` storageState — no per-test login.

test('rack detail and elevation layout', async ({ page }) => {
	await page.goto('/racks')
	await page.getByRole('link', { name: 'E2E Visual Rack' }).click()
	await expect(page.getByRole('heading', { name: 'E2E Visual Rack 10 HE' })).toBeVisible()
	await expect(page.getByRole('link', { name: 'E2E Edge Server' }).first()).toBeVisible()
	await expect(page.getByRole('link', { name: 'E2E Rack Switch' }).first()).toBeVisible()
	await expect(page.getByRole('link', { name: 'E2E Spare Device' })).toBeVisible()
	await expect(page.getByRole('link', { name: /E2E Visual Shelf halbe Tiefe/ })).toBeVisible()
	await expect(page.getByRole('status', { name: '6 von 10 HE belegt' })).toBeVisible()
	await stabilizeForSnapshot(page)
	await expect(page).toHaveScreenshot('rack-detail-and-elevation.png')
})
