import { expect, test } from '@playwright/test'

// Auth comes from `auth.setup.ts` storageState — no per-test login.

// Exemplary test. The same behaviour applies to all entities.
// Saving an edit opened from the table must return to the table (see `useFormReturnRoute`),
// not to the detail page.
test('saving a device role edited from the table returns to the table', async ({ page }) => {
	const roleName = `E2E Table Role ${Date.now()}`
	const renamed = `${roleName} Renamed`
	const created = await page.request.post('/api/device-roles', { data: { name: roleName } })
	expect(created.ok()).toBeTruthy()
	const { id } = (await created.json()) as { id: number }
	try {
		await page.goto('/device-roles')
		await page.getByRole('button', { name: `Bearbeiten: ${roleName}` }).click()
		await expect(page).toHaveURL(new RegExp(`/device-roles/${id}/edit`))

		await page.locator('#device-role-edit-name').fill(renamed)
		await page.locator('.tab-pane:not([hidden]) .form-actions button[type="submit"]').click()

		// Back on the table, not the detail page.
		await expect(page).toHaveURL(/\/device-roles$/)
		await expect(page.getByRole('link', { name: renamed, exact: true })).toBeVisible()
		await expect(page.locator('[data-tab-button]')).toHaveCount(1)
	} finally {
		await page.request.delete(`/api/device-roles/${id}`)
	}
})
