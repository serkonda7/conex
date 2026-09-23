import { expect, test } from '@playwright/test'

// Auth comes from `auth.setup.ts` storageState — no per-test login.

test('selecting a site keeps the tenant selected and site present', async ({ page }) => {
	await page.goto('/locations/add')
	await expect(page.locator('#location-site option', { hasText: 'E2E Site' })).toHaveCount(1)
	await page.locator('#location-name').fill('E2E Location')
	await page.locator('#location-site').selectOption({ label: 'E2E Site' })

	await expect(page.locator('#location-tenant')).toHaveValue(/\d+/)
	await expect(page.locator('#location-tenant option:checked')).toHaveText('E2E Tenant')
	await expect(page.locator('#location-site')).toHaveValue(/\d+/)
	await expect(page.locator('#location-site option:checked')).toHaveText('E2E Site')
	await expect(page.locator('#location-site option', { hasText: 'E2E Site' })).toHaveCount(1)
})
