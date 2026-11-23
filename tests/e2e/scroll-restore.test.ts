import { expect, type Page, test } from '@playwright/test'

// Auth comes from `auth.setup.ts` storageState — no per-test login.
//
// The page remounts on every route change, so scroll positions are restored
// by the router from history.state once the asynchronously loaded page is
// tall enough.

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

test('Back restores the previous page scroll and a cancelled form returns to the opener position', async ({
	page,
}) => {
	const rackPath = await openRack(page)

	// Scroll down to a free U; hovering reveals its add button.
	const freeSlot = page.getByTestId('rack-elevation').locator('.rack-u-free').last()
	await freeSlot.scrollIntoViewIfNeeded()
	await freeSlot.hover()
	const rackScroll = await scrollY(page)
	expect(rackScroll).toBeGreaterThan(100)

	// The add form is a new history entry and starts at the top.
	await freeSlot.getByRole('button', { name: '+ Gerät', exact: true }).click()
	await expect(page).toHaveURL(/\/devices\/add\?/)
	await expect.poll(() => scrollY(page)).toBe(0)

	// Browser Back restores the rack's scroll position.
	await page.goBack()
	await expect(page).toHaveURL(new RegExp(`${rackPath}$`))
	await expect.poll(() => scrollY(page)).toBe(rackScroll)
	await page.waitForTimeout(300)
	expect(await scrollY(page)).toBe(rackScroll)

	// Open the form again; cancelling must return to the rack where it was left.
	const slotAgain = page.getByTestId('rack-elevation').locator('.rack-u-free').last()
	await slotAgain.scrollIntoViewIfNeeded()
	await slotAgain.hover()
	const openerScroll = await scrollY(page)
	expect(openerScroll).toBeGreaterThan(100)
	await slotAgain.getByRole('button', { name: '+ Gerät', exact: true }).click()
	await expect(page).toHaveURL(/\/devices\/add\?/)
	await page.locator('#main .form-actions > button').first().click()

	await expect(page).toHaveURL(new RegExp(`${rackPath}$`))
	await expect.poll(() => scrollY(page)).toBe(openerScroll)
})
