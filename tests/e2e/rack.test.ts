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

test('rack type is saved, displayed, and drives elevation', async ({ page }) => {
	await page.goto('/')
	await page.getByLabel('Username').fill(username)
	await page.locator('input[type="password"]').fill(password)
	await page.getByRole('button', { name: 'Sign in' }).click()
	await expect(page.getByRole('link', { name: 'Racks' })).toBeVisible()

	await page.goto('/racks/add')
	await page.locator('#rack-site').selectOption({ label: 'E2E Site' })
	await page.getByLabel('Name').fill('Type display rack')
	await page.locator('#rack-type').selectOption({ label: 'E2E 42U Cabinet (E2E Maker)' })
	await page.getByRole('button', { name: 'Create', exact: true }).click()

	await expect(page.getByRole('link', { name: 'Type display rack' })).toBeVisible()
	await expect(page.getByText('E2E 42U Cabinet')).toBeVisible()
	await page.getByRole('link', { name: 'Type display rack' }).click()

	// The selected rack type supplies the height shown in the heading and elevation.
	await expect(page.getByRole('heading', { name: /Type display rack.*42U/ })).toBeVisible()
	await expect(page.getByText('0/42U · 0% used')).toBeVisible()
	await expect(page.getByRole('status', { name: '0 of 42U used' })).toBeVisible()
	await expect(
		page.locator('section[aria-label="Rack elevation (front face)"] li.rack-u'),
	).toHaveCount(42)
	await expect(
		page.locator('section[aria-label="Rack elevation (rear face)"] li.rack-u'),
	).toHaveCount(42)
	const frontUnits = page.locator(
		'section[aria-label="Rack elevation (front face)"] li.rack-u .rack-u-gutter',
	)
	await expect(frontUnits.first()).toHaveText('42')
	await expect(frontUnits.last()).toHaveText('1')
})
