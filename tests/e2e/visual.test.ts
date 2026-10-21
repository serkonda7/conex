import { expect, type Page, test } from '@playwright/test'
import { stabilizeForSnapshot } from './helpers'

// Screenshot suite at 1920x1080 to catch layout regressions.
// Regenerate baselines: `bun run test:visual:update` (review PNGs in git).
// Auth comes from `auth.setup.ts` storageState — no per-test login.

test('rack detail and elevation layout', async ({ page }) => {
	const rackListResponse = await page.request.get(
		'/api/racks?search=E2E%20Visual%20Rack&page=1&limit=200',
	)
	expect(rackListResponse.ok()).toBeTruthy()
	const rackList = (await rackListResponse.json()) as {
		items: { id: number; name: string }[]
	}
	const rackId = rackList.items.find((rack) => rack.name === 'E2E Visual Rack')?.id
	expect(rackId).toBeDefined()
	await page.goto('/racks')
	await page.locator(`a[href="/racks/${rackId}"]`).click()
	await expect(page.getByTestId('rack-detail-title')).toBeVisible()
	await expect(page.getByTestId('rack-utilization')).toBeVisible()
	await expect(page.getByTestId('rack-elevation')).toBeVisible()
	await expect(page.getByTestId('rack-elevation').locator('.rack-elev')).toHaveCount(2)
	await stabilizeForSnapshot(page)
	await expect(page.locator('main.app-content')).toHaveScreenshot('rack-detail-and-elevation.png')
})

test('device type edit form layout', async ({ page }) => {
	const deviceTypesResponse = await page.request.get(
		'/api/device-types?search=E2E%2042U%20Cabinet&limit=200&kind=rack',
	)
	expect(deviceTypesResponse.ok()).toBeTruthy()
	const deviceTypes = (await deviceTypesResponse.json()) as {
		items: { id: number; model: string }[]
	}
	const deviceTypeId = deviceTypes.items.find(
		(deviceType) => deviceType.model === 'E2E 42U Cabinet',
	)?.id
	expect(deviceTypeId).toBeDefined()

	await page.goto(`/device-types/${deviceTypeId}/edit`)
	await expect(page.locator('#device-type-edit-full-depth')).toBeVisible()
	await expect(page.locator('#device-type-edit-model')).toHaveValue('E2E 42U Cabinet')
	await stabilizeForSnapshot(page)
	await expect(page.locator('main.app-content')).toHaveScreenshot('device-type-edit-form.png')
})

test('locations list layout', async ({ page }) => {
	await page.goto('/locations')
	await expect(page.locator('main.app-content h2')).toBeVisible()
	await expect(page.locator('main.app-content .skeleton')).toHaveCount(0)
	await stabilizeForSnapshot(page)
	await expect(page.locator('main.app-content')).toHaveScreenshot('locations-list.png')
})

test('device types list layout', async ({ page }) => {
	await page.goto('/device-types')
	await expect(page.getByRole('link', { name: 'E2E 2U Server', exact: true })).toBeVisible()
	await expect(page.locator('main.app-content .skeleton')).toHaveCount(0)
	await stabilizeForSnapshot(page)
	await expect(page.locator('main.app-content')).toHaveScreenshot('device-types-list.png')
})

test('device roles list layout', async ({ page }) => {
	await page.goto('/device-roles')
	await expect(page.getByRole('link', { name: 'E2E Role', exact: true })).toBeVisible()
	await expect(page.getByRole('link', { name: 'E2E Child Role', exact: true })).toBeVisible()
	await expect(page.locator('main.app-content .skeleton')).toHaveCount(0)
	await stabilizeForSnapshot(page)
	await expect(page.locator('main.app-content')).toHaveScreenshot('device-roles-list.png')
})

test('device add form layout', async ({ page }) => {
	// With a tenant in the global context the employee picker is enabled.
	const response = await page.request.get('/api/tenants?search=E2E%20Tenant&limit=200')
	expect(response.ok()).toBeTruthy()
	const list = (await response.json()) as { items: { id: number; name: string }[] }
	const tenantId = list.items.find((tenant) => tenant.name === 'E2E Tenant')?.id
	expect(tenantId).toBeDefined()
	await page.addInitScript((id: number) => {
		window.localStorage.setItem('conex:tenant-context', `tenant:${id}`)
	}, tenantId as number)

	await page.goto('/devices/add')
	await expect(page.locator('#device-name')).toBeVisible()
	await expect(page.locator('#device-employee')).toBeEnabled()
	await expect(page.locator('.form-section-title')).toHaveCount(3)
	await stabilizeForSnapshot(page)
	await expect(page.locator('main.app-content')).toHaveScreenshot('device-add-form.png')
})

test('device edit form layout', async ({ page }) => {
	const response = await page.request.get('/api/devices?search=E2E%20Edge%20Server&limit=200')
	expect(response.ok()).toBeTruthy()
	const list = (await response.json()) as { items: { id: number; name: string }[] }
	const deviceId = list.items.find((device) => device.name === 'E2E Edge Server')?.id
	expect(deviceId).toBeDefined()

	await page.goto(`/devices/${deviceId}/edit`)
	await expect(page.locator('#device-edit-name')).toHaveValue('E2E Edge Server')
	await expect(page.locator('#device-edit-rack')).toHaveValue('E2E Visual Rack')
	await expect(page.locator('#device-edit-position')).toHaveValue('9')
	await expect(page.locator('.form-section-title')).toHaveCount(3)
	await stabilizeForSnapshot(page)
	await expect(page.locator('main.app-content')).toHaveScreenshot('device-edit-form.png')
})

test('ticket add form layout', async ({ page }) => {
	await page.goto('/tickets/add')
	await expect(page.locator('#ticket-title')).toBeVisible()
	await expect(page.locator('#ticket-content')).toBeVisible()
	await expect(page.locator('#ticket-device')).toBeVisible()
	await expect(page.locator('#ticket-employee')).toBeVisible()
	await expect(page.locator('#ticket-priority')).toBeVisible()
	await stabilizeForSnapshot(page)
	await expect(page.locator('main.app-content')).toHaveScreenshot('ticket-add-form.png')
})

async function visualEmployeeId(page: Page): Promise<number> {
	const response = await page.request.get('/api/employees?search=E2E%20Visual&limit=200')
	expect(response.ok()).toBeTruthy()
	const list = (await response.json()) as { items: { id: number; last_name: string }[] }
	const id = list.items.find((employee) => employee.last_name === 'E2E Visual')?.id
	expect(id).toBeDefined()
	return id as number
}

test('employee detail layout', async ({ page }) => {
	const employeeId = await visualEmployeeId(page)
	await page.goto(`/employees/${employeeId}`)
	await expect(page.locator('main.app-content h2')).toContainText('Erika E2E Visual')
	await expect(page.locator('.breadcrumbs')).toContainText('E2E Tenant')
	await expect(page.locator('.contact-list li')).toHaveCount(5)
	await stabilizeForSnapshot(page)
	await expect(page.locator('main.app-content')).toHaveScreenshot('employee-detail.png')
})

// Ticket times are formatted in the browser's zone: pin it for stable baselines.
test.describe('tenant detail', () => {
	test.use({ timezoneId: 'UTC' })

	test('tenant detail layout', async ({ page }) => {
		const response = await page.request.get('/api/tenants?search=E2E%20Tenant&limit=200')
		expect(response.ok()).toBeTruthy()
		const list = (await response.json()) as { items: { id: number; name: string }[] }
		const tenantId = list.items.find((tenant) => tenant.name === 'E2E Tenant')?.id
		expect(tenantId).toBeDefined()

		// No integration is seeded: mock one with findings so "Needs attention" renders.
		await page.route('**/api/integrations', async (route) => {
			if (route.request().method() !== 'GET') {
				return route.fallback()
			}
			await route.fulfill({
				json: [
					{
						id: 1,
						provider: 'tanss',
						base_url: 'https://tanss.example.com',
						username: 'e2e',
						has_password: true,
						has_erp_token: false,
						enabled: true,
						created_at: 0,
						updated_at: 0,
						last_login_ok_at: null,
						last_error: null,
						last_sync: null,
					},
				],
			})
		})
		await page.route('**/api/integrations/tanss/tenant-status/*', async (route) => {
			await route.fulfill({
				json: {
					link: null,
					external: null,
					finding_counts: { device_missing_in_conex: 3, device_mismatch: 2 },
				},
			})
		})

		await page.route('**/api/integrations/tanss/tickets?*', async (route) => {
			await route.fulfill({
				json: {
					linked: true,
					base_url: 'https://tanss.example.com',
					fetched_at: 1_767_268_800,
					tickets: [
						{
							id: 1001,
							title: 'Printer offline',
							status: 'Open',
							created_at: 1_767_182_400,
							modified_at: 1_767_225_600,
						},
						{
							id: 1002,
							title: 'VPN connection drops',
							status: 'In progress',
							created_at: 1_767_096_000,
							modified_at: 1_767_139_200,
						},
					],
				},
			})
		})

		await page.goto(`/tenants/${tenantId}`)
		await expect(page.locator('main.app-content h2')).toContainText('E2E Tenant')
		await expect(page.locator('.tenant-rows .tenant-tag')).toHaveCount(2)
		await expect(page.getByRole('link', { name: '1001' })).toBeVisible()
		await expect(page.locator('main.app-content .skeleton')).toHaveCount(0)
		await stabilizeForSnapshot(page)
		await expect(page.locator('main.app-content')).toHaveScreenshot('tenant-detail.png', {
			// Recent changes show relative times.
			mask: [page.locator('.tenant-changes')],
		})
	})
})

test('employee edit form layout', async ({ page }) => {
	const employeeId = await visualEmployeeId(page)
	await page.goto(`/employees/${employeeId}/edit`)
	await expect(page.locator('#employee-edit-last-name')).toHaveValue('E2E Visual')
	await expect(page.locator('#employee-edit-phone-2')).toHaveValue('+49 30 7654321')
	await stabilizeForSnapshot(page)
	await expect(page.locator('main.app-content')).toHaveScreenshot('employee-edit-form.png')
})

test('floor plan with polygon area layout', async ({ page }) => {
	const locationsResponse = await page.request.get(
		'/api/locations?search=E2E%20Floor%202&limit=200',
	)
	const location = (
		(await locationsResponse.json()) as { items: { id: number; name: string }[] }
	).items.find((item) => item.name === 'E2E Floor 2')
	expect(location).toBeDefined()
	const attachmentsResponse = await page.request.get(`/api/attachments?location=${location?.id}`)
	const plan = (
		(await attachmentsResponse.json()) as { id: number; is_floorplan: boolean }[]
	).find((item) => item.is_floorplan)
	expect(plan).toBeDefined()

	await page.goto(`/floorplans/${plan?.id}`)
	await expect(page.locator('.floorplan-area polygon')).toHaveCount(1)
	await expect(page.locator('.floorplan-area-label')).toHaveText('E2E Triangle')
	await expect(page.locator('main.app-content .skeleton')).toHaveCount(0)
	await stabilizeForSnapshot(page)
	await expect(page.locator('main.app-content')).toHaveScreenshot('floorplan-polygon.png')
})

test('expanded sidebar layout', async ({ page }) => {
	await page.goto('/locations')
	await expect(page.locator('main.app-content h2')).toBeVisible()
	await expect(page.locator('.app-sidebar.collapsed')).toHaveCount(0)
	await stabilizeForSnapshot(page)
	await expect(page.locator('.app-sidebar')).toHaveScreenshot('sidebar-expanded.png', {
		mask: [page.locator('.app-user-username')],
		maskColor: '#242424',
	})
})

// Top-left strip (top bar + sidebar top) with the tenant dropdown open:
// guards the dropdown's stacking above the sidebar.
const topLeftCorner = { x: 0, y: 0, width: 480, height: 210 }

for (const collapsed of [false, true]) {
	const state = collapsed ? 'collapsed' : 'expanded'
	test(`tenant dropdown over ${state} sidebar`, async ({ page }) => {
		await page.goto('/locations')
		await expect(page.locator('main.app-content h2')).toBeVisible()
		if (collapsed) {
			await page.locator('.app-sidebar-toggle').click()
			await expect(page.locator('.app-sidebar.collapsed')).toBeVisible()
		}
		await page.locator('.app-tenant-context-button').click()
		await expect(page.locator('.app-tenant-context-popover')).toBeVisible()
		await stabilizeForSnapshot(page)
		await expect(page).toHaveScreenshot(`tenant-dropdown-${state}-sidebar.png`, {
			clip: topLeftCorner,
		})
	})
}
