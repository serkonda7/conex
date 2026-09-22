import { expect, type Page, test } from '@playwright/test'

const username: string = process.env.CONEX_E2E_USERNAME ?? 'e2e-user'
const password: string = process.env.CONEX_E2E_PASSWORD ?? 'e2e-secret-123'

async function login(page: Page): Promise<void> {
	await page.goto('/')
	await page.getByLabel('Username').fill(username)
	await page.locator('input[type="password"]').fill(password)
	await page.getByRole('button', { name: 'Sign in' }).click()
	await expect(page.getByRole('link', { name: 'Locations' })).toBeVisible()
}

test('add form opens in a new tab and preserves the list behind it', async ({ page }) => {
	await login(page)
	await page.goto('/tenants')
	await expect(page.getByRole('tab', { name: 'Tenants' })).toBeVisible()

	// Give the list something to remember.
	await page.getByLabel('Search tenants').fill('E2E Tenant')
	await expect(page.getByRole('link', { name: 'E2E Tenant' })).toBeVisible()

	// Opening the create form must not discard the list.
	await page.getByRole('button', { name: '+ Add' }).click()
	await expect(page.getByRole('tab', { name: 'Add Tenant' })).toBeVisible()
	await expect(page.locator('#tenant-name')).toBeVisible()

	// The background tab keeps its search filter…
	await page.getByRole('tab', { name: 'Tenants' }).click()
	await expect(page.getByLabel('Search tenants')).toHaveValue('E2E Tenant')
	await expect(page.getByRole('link', { name: 'E2E Tenant' })).toBeVisible()

	// …and the form tab keeps its (empty) draft when revisited.
	await page.getByRole('tab', { name: 'Add Tenant' }).click()
	await expect(page.locator('#tenant-name')).toHaveValue('')

	// Cancel closes the form tab and restores the untouched list.
	await page.getByRole('button', { name: 'Cancel' }).click()
	await expect(page.getByRole('tab', { name: 'Add Tenant' })).toHaveCount(0)
	await expect(page.getByLabel('Search tenants')).toHaveValue('E2E Tenant')
})

test('edit opens in a new tab and save closes it', async ({ page }) => {
	await login(page)
	await page.goto('/tenants')
	await expect(page.getByRole('link', { name: 'E2E Tenant' })).toBeVisible()

	await page.getByRole('button', { name: 'Edit tenant E2E Tenant' }).click()
	const editTab = page.getByRole('tab', { name: /Edit Tenant/ })
	await expect(editTab).toBeVisible()
	await expect(page.locator('#tenant-edit-name')).toHaveValue('E2E Tenant')

	await page.locator('#tenant-edit-description').fill('tab-test description')
	await page.getByRole('button', { name: 'Save' }).click()

	// The edit tab closes; the detail page shows the saved value.
	await expect(editTab).toHaveCount(0)
	await expect(page.getByRole('heading', { name: /E2E Tenant/ })).toBeVisible()
	await expect(page.getByText('tab-test description').first()).toBeVisible()
})

test('object links open in a new tab and keep the list behind them', async ({ page }) => {
	await login(page)
	await page.goto('/tenants')
	await expect(page.getByRole('tab', { name: 'Tenants' })).toBeVisible()
	await expect(page.getByRole('link', { name: 'E2E Tenant' })).toBeVisible()

	// Following an object link must not discard the list.
	await page.getByRole('link', { name: 'E2E Tenant' }).click()
	const objectTab = page.getByRole('tab', { name: /Tenant \d+/ })
	await expect(objectTab).toBeVisible()
	await expect(page.getByRole('heading', { name: /E2E Tenant/ })).toBeVisible()

	// The list tab is untouched behind it.
	await page.getByRole('tab', { name: 'Tenants' }).click()
	await expect(page.getByRole('link', { name: 'E2E Tenant' })).toBeVisible()

	// Closing the object tab returns to the list.
	await objectTab.getByRole('button', { name: /Close Tenant/ }).click()
	await expect(objectTab).toHaveCount(0)
	await expect(page.getByRole('link', { name: 'E2E Tenant' })).toBeVisible()
})
