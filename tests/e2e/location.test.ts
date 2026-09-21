import { expect, test } from '@playwright/test'

const username: string = process.env.CONEX_E2E_USERNAME ?? 'e2e-user'
const password: string = process.env.CONEX_E2E_PASSWORD ?? 'e2e-secret-123'

test('selecting a site keeps the tenant selected and site present', async ({ page }) => {
	await page.goto('/')
	await page.getByLabel('Username').fill(username)
	await page.locator('input[type="password"]').fill(password)
	await page.getByRole('button', { name: 'Sign in' }).click()
	await expect(page.getByRole('link', { name: 'Locations' })).toBeVisible()

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
