import { expect, test } from '@playwright/test'

// Auth comes from `auth.setup.ts` storageState — no per-test login.

test('selecting a site prefills the rack tenant', async ({ page }) => {
	await page.goto('/racks/add')
	await expect(page.locator('#rack-site option', { hasText: 'E2E Site' })).toHaveCount(1)
	await page.locator('#rack-site').selectOption({ label: 'E2E Site' })

	await expect(page.locator('#rack-site')).toHaveValue(/\d+/)
	await expect(page.locator('#rack-site option:checked')).toHaveText('E2E Site')
	await expect(page.locator('#rack-tenant')).toHaveValue(/\d+/)
	await expect(page.locator('#rack-tenant option:checked')).toHaveText('E2E Tenant')
})
