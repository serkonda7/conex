import { expect, test } from '@playwright/test'

const username: string = process.env.CONEX_E2E_USERNAME ?? 'e2e-user'
const password: string = process.env.CONEX_E2E_PASSWORD ?? 'e2e-secret-123'

test('selecting a site prefills the rack tenant', async ({ page }) => {
	await page.goto('/')
	await page.getByLabel('Username').fill(username)
	await page.locator('input[type="password"]').fill(password)
	await page.getByRole('button', { name: 'Sign in' }).click()
	await expect(page.getByRole('link', { name: 'Racks' })).toBeVisible()

	await page.goto('/racks/add')
	await expect(page.locator('#rack-site option', { hasText: 'E2E Site' })).toHaveCount(1)
	await page.locator('#rack-site').selectOption({ label: 'E2E Site' })

	await expect(page.locator('#rack-site')).toHaveValue(/\d+/)
	await expect(page.locator('#rack-site option:checked')).toHaveText('E2E Site')
	await expect(page.locator('#rack-tenant')).toHaveValue(/\d+/)
	await expect(page.locator('#rack-tenant option:checked')).toHaveText('E2E Tenant')
})
