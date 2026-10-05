import { expect, test } from '@playwright/test'

// Auth comes from `auth.setup.ts` storageState — no per-test login.

test('selecting a site keeps the tenant selected and site present', async ({ page }) => {
	await page.goto('/locations/add')
	await page.locator('#location-name').fill('E2E Location')
	await page.locator('#location-site').fill('E2E Site')
	await page.getByRole('option', { name: 'E2E Site', exact: true }).click()

	await expect(page.locator('#location-tenant')).toHaveAttribute('data-value', /\d+/)
	await expect(page.locator('#location-tenant')).toHaveValue('E2E Tenant')
	await expect(page.locator('#location-site')).toHaveAttribute('data-value', /\d+/)
	await expect(page.locator('#location-site')).toHaveValue('E2E Site')
	await page.locator('#location-site').fill('E2E Site')
	await expect(page.getByRole('option', { name: 'E2E Site', exact: true })).toHaveCount(1)
})
