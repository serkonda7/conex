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

test('adding a device from the rack elevation prefills rack context', async ({ page }) => {
	const rackListResponse = await page.request.get(
		'/api/racks?search=E2E%20Visual%20Rack&page=1&limit=200',
	)
	expect(rackListResponse.ok()).toBeTruthy()
	const rackList = (await rackListResponse.json()) as {
		items: { id: number; name: string }[]
	}
	const rackId = rackList.items.find((rack) => rack.name === 'E2E Visual Rack')?.id
	expect(rackId).toBeDefined()

	await page.goto(`/racks/${rackId}`)
	await expect(page.getByTestId('rack-elevation')).toBeVisible()
	// Free-U actions only show on hover.
	const freeSlot = page.getByTestId('rack-elevation').locator('.rack-u-free').first()
	await freeSlot.hover()
	await freeSlot.getByRole('button', { name: '+ Gerät', exact: true }).click()

	await expect(page).toHaveURL(/\/devices\/add\?/)
	await expect(page.locator('#device-rack option:checked')).toHaveText('E2E Visual Rack')
	await expect(page.locator('#device-site option:checked')).toHaveText('E2E Site')
	await expect(page.locator('#device-tenant option:checked')).toHaveText('E2E Tenant')
})
