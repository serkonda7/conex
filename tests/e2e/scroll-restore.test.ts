import { expect, type Locator, type Page, test } from '@playwright/test'

// Auth comes from `auth.setup.ts` storageState — no per-test login.
//
// Tab and link switches use dispatched clicks: a real click first scrolls its
// target into view (the tab bar sits above the page), moving the very
// position under test.

/** The active tab's pane; background tabs stay mounted but hidden. */
function activePane(page: Page): Locator {
	return page.locator('.tab-pane:not([hidden])')
}

function scrollY(page: Page): Promise<number> {
	return page.evaluate(() => window.scrollY)
}

/** Opens the seeded rack in a short viewport, so its page scrolls. */
async function openRack(page: Page): Promise<string> {
	const rackListResponse = await page.request.get(
		'/api/racks?search=E2E%20Visual%20Rack&page=1&limit=200',
	)
	expect(rackListResponse.ok()).toBeTruthy()
	const rackList = (await rackListResponse.json()) as {
		items: { id: number; name: string }[]
	}
	const rackId = rackList.items.find((rack) => rack.name === 'E2E Visual Rack')?.id
	expect(rackId).toBeDefined()
	const rackPath = `/racks/${rackId}`

	await page.setViewportSize({ width: 1280, height: 500 })
	await page.goto(rackPath)
	await expect(page.getByTestId('rack-elevation')).toBeVisible()
	return rackPath
}

test('each tab keeps its scroll position across tab switches and form cancel', async ({ page }) => {
	const rackPath = await openRack(page)

	// Scroll down to a free U; hovering reveals its add button.
	const freeSlot = page.getByTestId('rack-elevation').locator('.rack-u-free').last()
	await freeSlot.scrollIntoViewIfNeeded()
	await freeSlot.hover()
	const rackScroll = await scrollY(page)
	expect(rackScroll).toBeGreaterThan(100)

	// The add form opens in its own tab, starting at the top.
	await freeSlot.getByRole('button', { name: '+ Gerät', exact: true }).click()
	await expect(page).toHaveURL(/\/devices\/add\?/)
	await expect(page.locator('[data-tab-button]')).toHaveCount(2)
	await expect.poll(() => scrollY(page)).toBe(0)

	// Switching to the rack tab restores its position, and back the form's.
	await page.locator('[data-tab-button]').first().dispatchEvent('click')
	await expect(page).toHaveURL(new RegExp(`${rackPath}$`))
	await expect.poll(() => scrollY(page)).toBe(rackScroll)
	await page.locator('[data-tab-button]').last().dispatchEvent('click')
	await expect(page).toHaveURL(/\/devices\/add\?/)
	await expect.poll(() => scrollY(page)).toBe(0)

	// Cancelling the form returns to the rack where it was left.
	await activePane(page).locator('.form-actions > button').first().click()
	await expect(page).toHaveURL(new RegExp(`${rackPath}$`))
	await expect(page.locator('[data-tab-button]')).toHaveCount(1)
	await expect.poll(() => scrollY(page)).toBe(rackScroll)
	// Stays there once the page settles (autofocus, tab bar re-measure).
	await page.waitForTimeout(300)
	expect(await scrollY(page)).toBe(rackScroll)
})
