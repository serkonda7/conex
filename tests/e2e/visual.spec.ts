import { expect, test } from '@playwright/test'
import { loginAsE2E, stabilizeForSnapshot } from './helpers'

// Screenshot suite at 1920x1080 to catch layout regressions. Currently
// scoped to the device-types/add page only.
// Regenerate baselines: `bun run test:visual:update` (review PNGs in git).

test('device type add form layout', async ({ page }) => {
	await loginAsE2E(page)
	await page.goto('/device-types/add')
	await expect(page.getByRole('heading', { name: 'Add a device type' })).toBeVisible()
	await stabilizeForSnapshot(page)
	await expect(page).toHaveScreenshot('device-type-add-form.png')
})
