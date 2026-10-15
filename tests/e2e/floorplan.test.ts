import { expect, type Page, test } from '@playwright/test'

// Auth comes from `auth.setup.ts` storageState — no per-test login.
// The seed creates an empty floor plan on "E2E Floor 1" (drawing target).

async function planIdOf(page: Page, locationName: string): Promise<number> {
	const locations = await page.request.get(
		`/api/locations?search=${encodeURIComponent(locationName)}&limit=200`,
	)
	const location = (
		(await locations.json()) as { items: { id: number; name: string }[] }
	).items.find((item) => item.name === locationName)
	expect(location).toBeDefined()
	const attachments = await page.request.get(`/api/attachments?location=${location?.id}`)
	const plan = ((await attachments.json()) as { id: number; is_floorplan: boolean }[]).find(
		(item) => item.is_floorplan,
	)
	expect(plan).toBeDefined()
	return plan?.id as number
}

test('draws a polygon area, finishes it with Enter and keeps it after saving', async ({ page }) => {
	const planId = await planIdOf(page, 'E2E Floor 1')
	// Start from the seeded empty plan even when an earlier run saved an area.
	await page.request.put(`/api/attachments/${planId}/plan`, {
		data: { areas: [], placements: [] },
	})

	await page.goto(`/floorplans/${planId}`)
	await page.getByRole('button', { name: 'Grundriss bearbeiten' }).click()
	await page.getByRole('button', { name: 'Bereich zeichnen' }).click()

	const stage = page.locator('.floorplan-stage')
	const box = await stage.boundingBox()
	expect(box).not.toBeNull()
	const at = (x: number, y: number): { x: number; y: number } => ({
		x: (box?.x ?? 0) + (box?.width ?? 0) * x,
		y: (box?.y ?? 0) + (box?.height ?? 0) * y,
	})
	// Plain clicks (no drag) set the corners of an L-shaped polygon.
	const corners: [number, number][] = [
		[0.2, 0.2],
		[0.6, 0.2],
		[0.6, 0.5],
		[0.4, 0.5],
		[0.4, 0.8],
		[0.2, 0.8],
	]
	for (const [x, y] of corners) {
		await page.mouse.click(at(x, y).x, at(x, y).y)
	}
	await expect(page.getByText('Enter')).toBeVisible()
	await page.keyboard.press('Enter')

	await page.getByRole('dialog').getByRole('button', { name: 'Bereich', exact: true }).click()
	await page.getByRole('dialog').getByRole('textbox').fill('E2E Cage A')
	await page.getByRole('button', { name: 'E2E Cage A' }).click()
	await expect(page.locator('.floorplan-area-editing')).toHaveCount(1)

	await page.getByRole('button', { name: 'Speichern' }).click()
	await expect(page.getByRole('button', { name: 'Grundriss bearbeiten' })).toBeVisible()

	await page.reload()
	await expect(page.locator('.floorplan-area')).toHaveCount(1)
	const plan = await page.request.get(`/api/attachments/${planId}/plan`)
	const saved = (await plan.json()) as { areas: { points: [number, number][] }[] }
	expect(saved.areas).toHaveLength(1)
	expect(saved.areas[0]?.points).toHaveLength(corners.length)
})
