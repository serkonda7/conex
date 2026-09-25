import { expect, test } from '@playwright/test'

// Auth comes from `auth.setup.ts` storageState — no per-test login.
//
// Covers shelf creation/editing from rack elevation and the U-space rules.
// Names carry a timestamp so repeated local runs do not clash with leftovers.
test('shelves are separate rack fixtures', async ({ page }) => {
	const stamp = Date.now()
	const rackName = `Shelf rack ${stamp}`

	// A tall rack for the shelf scenario.
	await page.goto('/racks/add')
	await page.locator('#rack-site').selectOption({ label: 'E2E Site' })
	await page.getByLabel('Name').fill(rackName)
	await page.locator('#rack-type').selectOption({ label: 'E2E 42U Cabinet (E2E Maker)' })
	await page.getByRole('button', { name: 'Erstellen', exact: true }).click()
	await expect(page.getByRole('link', { name: rackName })).toBeVisible()

	await test.step('add a shelf from the rack elevation free-U button', async () => {
		await page.goto('/racks')
		await page.getByRole('link', { name: rackName }).click()
		const front = 'section[aria-label="Rackansicht (Vorderseite)"]'
		// Free-U actions only appear on hover; the Add shelf button sits
		// next to Select/Add device.
		const row10 = page.locator(`${front} li.rack-u-free[data-u="10"]`)
		await row10.hover()
		await expect(
			row10.getByRole('button', { name: 'Fachboden hinzufügen', exact: true }),
		).toBeVisible()
		await row10.getByRole('button', { name: 'Fachboden hinzufügen', exact: true }).click()

		// The shelf add form is pre-filled with rack, position and face.
		await expect(page.locator('#shelf-position')).toHaveValue('10')
		await expect(page.locator('#shelf-name')).toBeVisible()
		await expect(page.locator('#shelf-description')).toHaveCount(0)
		await page.locator('#shelf-mount-height').fill('1')
		await page.locator('#shelf-reserved-height').fill('2')
		await page.getByRole('button', { name: 'Erstellen', exact: true }).click()
		await expect(page).toHaveURL(/\/racks\/\d+$/)
	})

	await test.step('the elevation shows the shelf block with its reserve', async () => {
		await page.goto('/racks')
		await page.getByRole('link', { name: rackName }).click()
		const front = 'section[aria-label="Rackansicht (Vorderseite)"]'
		// The shelf spans HE10 (mount) plus HE11–12 (reserve); the reserved
		// rows have no free-U actions.
		await expect(page.getByLabel('Fachboden HE10, HE10–HE12').first()).toBeVisible()
		await expect(page.locator(`${front} .rack-shelf-plate`).first()).toContainText('Fachboden')
		await expect(page.getByText('Reserviert · 2 HE').first()).toBeVisible()
		await expect(page.getByRole('status', { name: '3 von 42 HE belegt' })).toBeVisible()
		await expect(page.locator(`${front} li.rack-u`)).toHaveCount(39)
		await expect(page.locator(`${front} button[title*="HE11"]`)).toHaveCount(0)
		await expect(page.locator(`${front} button[title*="HE12"]`)).toHaveCount(0)
	})

	await test.step('U-mounting into the blocked span fails', async () => {
		await page.goto('/devices/add')
		await page.locator('#device-name').fill(`Blocker ${stamp}`)
		await page.locator('#device-type').selectOption({ label: 'E2E 1U Switch (E2E Maker)' })
		await page.locator('#device-rack').selectOption({ label: rackName })
		await page.locator('#device-position').fill('12')
		await page.getByRole('button', { name: 'Erstellen', exact: true }).click()
		await expect(page.getByText(/overlap/i)).toBeVisible()
	})

	await test.step('moving the shelf re-renders the elevation', async () => {
		await page.goto('/racks')
		await page.getByRole('link', { name: rackName }).click()
		const shelfLink = page.locator('.rack-shelf-plate').first()
		await expect(shelfLink).toHaveAttribute('href', /\/shelves\/\d+\/edit$/)
		await shelfLink.click()
		await expect(page).toHaveURL(/\/shelves\/\d+\/edit$/)
		await expect(page.locator('#shelf-edit-name')).toBeVisible()
		await expect(page.locator('#shelf-edit-description')).toHaveCount(0)
		await page.locator('#shelf-edit-position').fill('20')
		await page.getByRole('button', { name: 'Speichern', exact: true }).click()
		await expect(page).toHaveURL(/\/racks\/\d+$/)

		await page.goto('/racks')
		await page.getByRole('link', { name: rackName }).click()
		await expect(page.getByLabel('Fachboden HE20, HE20–HE22').first()).toBeVisible()
		// The old rows are free again.
		const front = 'section[aria-label="Rackansicht (Vorderseite)"]'
		const row11 = page.locator(`${front} li.rack-u-free[data-u="11"]`)
		await row11.hover()
		await expect(
			row11.getByRole('button', { name: 'Gerät hinzufügen', exact: true }),
		).toBeVisible()
	})

	await test.step('put devices on a shelf and take them off again', async () => {
		const rackUrl = page.url()
		const shelfBlock = page.getByLabel('Fachboden HE20, HE20–HE22').first()
		const onShelf = `On shelf ${stamp}`

		// New device straight onto the shelf: no U of its own.
		await shelfBlock.hover()
		await shelfBlock.getByRole('button', { name: 'Gerät auf Fachboden hinzufügen' }).click()
		await expect(page).toHaveURL(/\/devices\/add\?.*shelf=\d+/)
		await page.locator('#device-name').fill(onShelf)
		await page.locator('#device-type').selectOption({ label: 'E2E 1U Switch (E2E Maker)' })
		await page.getByRole('button', { name: 'Erstellen', exact: true }).click()
		await expect(page).toHaveURL(rackUrl)
		await expect(shelfBlock.getByRole('link', { name: onShelf })).toBeVisible()
		await expect(page.getByRole('status', { name: '3 von 42 HE belegt' })).toBeVisible()

		// Taking it off keeps it in the rack, just unplaced.
		await shelfBlock.getByRole('button', { name: `${onShelf} vom Fachboden entfernen` }).click()
		await expect(shelfBlock.getByRole('link', { name: onShelf })).toHaveCount(0)
		const unracked = page.getByRole('region', { name: 'Nicht eingebaute Geräte' })
		await expect(unracked.getByRole('link', { name: onShelf })).toBeVisible()

		// An existing device can be picked back onto the shelf.
		await shelfBlock.hover()
		await shelfBlock.getByRole('button', { name: 'Gerät für Fachboden auswählen' }).click()
		const selector = page.getByRole('dialog')
		await selector.getByRole('textbox', { name: 'Einträge durchsuchen' }).fill(onShelf)
		await selector.getByRole('button', { name: onShelf }).click()
		await expect(shelfBlock.getByRole('link', { name: onShelf })).toBeVisible()
		await expect(unracked.getByRole('link', { name: onShelf })).toHaveCount(0)
	})

	await test.step('add a child device to a usable shelf mount', async () => {
		const rackId = new URL(page.url()).pathname.match(/\/racks\/(\d+)$/)?.[1]
		if (!rackId) {
			throw new Error('Expected rack detail URL')
		}
		await page.goto(`/shelves/add?rack=${rackId}&position_u=30&face=front`)
		await page.locator('#shelf-name').fill('Storage')
		await page.locator('#shelf-mount-usable').check()
		await page.getByRole('button', { name: 'Erstellen', exact: true }).click()
		await expect(page).toHaveURL(new RegExp(`/racks/${rackId}$`))

		const front = 'section[aria-label="Rackansicht (Vorderseite)"]'
		// An usable mount renders like any other shelf block (plate over the
		// mount rows) and offers U-mounting on hover.
		const shelfBlock = page.locator(`${front} li.rack-u-shelf`).filter({ hasText: 'Storage' })
		await expect(shelfBlock).toContainText('Montage nutzbar')
		await expect(shelfBlock).toHaveAttribute('aria-label', 'Fachboden HE30, HE30–HE30')
		const shelfEditHref = await shelfBlock.locator('a.rack-shelf-plate').getAttribute('href')
		await shelfBlock.hover()
		await shelfBlock.getByRole('button', { name: 'Untergerät hinzufügen' }).click()
		await expect(page.locator('#device-rack')).toHaveValue(rackId)
		await expect(page.locator('#device-position')).toHaveValue('30')
		const childName = `Shelf child ${stamp}`
		await page.locator('#device-name').fill(childName)
		await page.locator('#device-type').selectOption({ label: 'E2E 1U Switch (E2E Maker)' })
		await page.getByRole('button', { name: 'Erstellen', exact: true }).click()
		await expect(page).toHaveURL(new RegExp(`/racks/${rackId}$`))
		const childDevice = page.locator(`${front} li.rack-u-device`).filter({ hasText: childName })
		await expect(childDevice).toContainText('Fachboden HE30')
		const freeRow = page.locator(`${front} li.rack-u-free[data-u="29"]`)
		const [deviceBounds, freeBounds] = await Promise.all([
			childDevice.boundingBox(),
			freeRow.boundingBox(),
		])
		expect(deviceBounds?.width).toBeCloseTo(freeBounds?.width ?? 0, 1)

		if (!shelfEditHref) {
			throw new Error('Expected shelf edit link')
		}
		await page.goto(shelfEditHref)
		await page.once('dialog', (dialog) => dialog.accept())
		await page.getByRole('button', { name: 'Löschen' }).click()
		await expect(page).toHaveURL(new RegExp(`/racks/${rackId}$`))
	})
})
