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

test('rack type is saved, displayed, and drives elevation', async ({ page }) => {
	await page.goto('/racks/add')
	await page.locator('#rack-site').selectOption({ label: 'E2E Site' })
	await page.getByLabel('Name').fill('Type display rack')
	await page.locator('#rack-type').selectOption({ label: 'E2E 42U Cabinet (E2E Maker)' })
	await page.getByRole('button', { name: 'Erstellen', exact: true }).click()

	await expect(page.getByRole('link', { name: 'Type display rack' })).toBeVisible()
	await expect(
		page.getByRole('row', { name: /Type display rack/ }).getByText('E2E 42U Cabinet'),
	).toBeVisible()
	await page.getByRole('link', { name: 'Type display rack' }).click()

	// The selected rack type supplies the height shown in the heading and elevation.
	await expect(page.getByRole('heading', { name: /Type display rack.*42 HE/ })).toBeVisible()
	await expect(page.getByText('0/42 HE · 0 % belegt')).toBeVisible()
	await expect(page.getByRole('status', { name: '0 von 42 HE belegt' })).toBeVisible()
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
