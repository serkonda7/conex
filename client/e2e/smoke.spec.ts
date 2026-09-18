import { expect, test } from '@playwright/test'

/**
 * P6 smoke: login → site → rack → device → cable, then search.
 * UI-driven where the UI supports it (login, site create, device
 * instantiate, cable connect); the rack and device template go through the
 * API because they have no create form yet. Every entity is then asserted
 * visible in the UI.
 *
 * Run: `bun run test:e2e` (from `client/`). Needs `bunx playwright install
 * chromium` once; set `CONEX_E2E_REUSE_SERVERS=1` to reuse hand-started
 * servers instead of the managed ones.
 */

const API: string = process.env.CONEX_E2E_API_URL ?? 'http://localhost:3100'
const EMAIL: string = process.env.CONEX_E2E_EMAIL ?? 'e2e@example.com'
const PASSWORD: string = process.env.CONEX_E2E_PASSWORD ?? 'e2e-secret-123'
const tag: string = `e2e-${Date.now().toString(36)}`

let cookie: string = ''

async function api(
	method: string,
	apiPath: string,
	body?: unknown,
): Promise<{ status: number; json: unknown }> {
	const res = await fetch(`${API}${apiPath}`, {
		method,
		headers: { cookie, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
		body: body === undefined ? undefined : JSON.stringify(body),
	})
	let json: unknown = null
	try {
		json = await res.json()
	} catch {
		json = null
	}
	return { status: res.status, json }
}

function idOf(res: { json: unknown }): string {
	return (res.json as { id: string }).id
}

test('smoke: login → site → rack → device → cable', async ({ page }) => {
	// Login through the UI.
	await page.goto('/')
	await page.locator('input[type="email"]').fill(EMAIL)
	await page.locator('input[type="password"]').fill(PASSWORD)
	await page.getByRole('button', { name: 'Sign in' }).click()
	await expect(page.getByRole('link', { name: 'Devices' })).toBeVisible()

	// Site through the UI (Add site form on /sites).
	await page.getByRole('link', { name: 'Sites' }).click()
	await page.locator('input[placeholder="Name"]').fill(`${tag} site`)
	await page.locator('input[placeholder="slug"]').fill(`${tag}-site`)
	await page.getByRole('button', { name: 'Add site' }).click()
	await expect(page.locator('table').getByText(`${tag} site`)).toBeVisible()

	// API session mirrors the browser login for the setup calls.
	const login = await fetch(`${API}/auth/login`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
	})
	expect(login.status).toBe(200)
	cookie = login.headers.get('set-cookie') ?? ''
	expect(cookie).toContain('auth_token=')

	const sites = await api('GET', `/sites?search=${tag}-site&page=1&limit=10`)
	expect(sites.status).toBe(200)
	const siteId = ((sites.json as { items: { id: string }[] }).items[0] as { id: string }).id

	// Rack + device template through the API (no create forms in the UI yet).
	const rack = await api('POST', '/racks', {
		name: `${tag} rack`,
		slug: `${tag}-rack`,
		site_id: siteId,
		height_u: 42,
	})
	expect(rack.status).toBe(201)
	const rackId = idOf(rack)

	const mfr = await api('POST', '/manufacturers', { name: `${tag} mfr`, slug: `${tag}-mfr` })
	expect(mfr.status).toBe(201)
	const dtype = await api('POST', '/device-types', {
		manufacturer_id: idOf(mfr),
		model: `${tag} switch`,
		slug: `${tag}-switch`,
		u_height: 1,
	})
	expect(dtype.status).toBe(201)
	const typeId = idOf(dtype)
	expect(
		(await api('POST', `/device-types/${typeId}/stubs`, { prefix: 'eth', count: 2 })).status,
	).toBe(201)

	// Devices through the UI instantiate form (needs a template + rack).
	await page.getByRole('link', { name: 'Devices' }).click()
	const instantiate = page.locator('form', {
		has: page.getByRole('button', { name: 'Create device' }),
	})
	await instantiate.locator('input[placeholder="Name"]').fill(`${tag}-a`)
	await instantiate
		.locator('select')
		.nth(0)
		.selectOption({ label: `${tag} switch (1U)` })
	await instantiate
		.locator('select')
		.nth(1)
		.selectOption({ label: `${tag} rack` })
	await instantiate.locator('input[placeholder="U position (or empty)"]').fill('10')
	await instantiate.getByRole('button', { name: 'Create device' }).click()
	await expect(page.locator('table').getByText(`${tag}-a`)).toBeVisible()

	await instantiate.locator('input[placeholder="Name"]').fill(`${tag}-b`)
	await instantiate
		.locator('select')
		.nth(0)
		.selectOption({ label: `${tag} switch (1U)` })
	await instantiate.locator('select').nth(1).selectOption({ label: 'Unracked' })
	await instantiate.getByRole('button', { name: 'Create device' }).click()
	await expect(page.locator('table').getByText(`${tag}-b`)).toBeVisible()

	const devList = await api('GET', '/devices?search=&page=1&limit=200')
	const devItems = (devList.json as { items: { id: string; name: string }[] }).items
	const devA = devItems.find((d) => d.name === `${tag}-a`)
	const devB = devItems.find((d) => d.name === `${tag}-b`)
	expect(devA).toBeDefined()
	expect(devB).toBeDefined()

	// Rack elevation shows the placed device.
	await page.goto(`/racks/${rackId}`)
	await expect(page.getByText(`${tag}-a`)).toBeVisible()

	// Cable through the UI connect dialog on the device page.
	await page.goto(`/devices/${devA?.id}`)
	await page.locator('select[aria-label="Local free port"]').selectOption({ label: 'eth0' })
	await page.locator('select[aria-label="Peer device"]').selectOption({ label: `${tag}-b` })
	await page.locator('select[aria-label="Peer free port"]').selectOption({ label: 'eth0' })
	await page.locator('input[placeholder="Label (optional)"]').fill(`${tag}-link`)
	await page.getByRole('button', { name: 'Connect' }).click()
	await expect(page.getByRole('cell', { name: `${tag}-link` })).toBeVisible()
	await expect(page.getByText('eth0 ↔')).toBeVisible()

	// Global search finds the site and the device.
	await page.goto(`/search?q=${tag}`)
	await expect(page.getByText(`${tag} site`)).toBeVisible()
	await expect(page.getByText(`${tag}-a`)).toBeVisible()
})
