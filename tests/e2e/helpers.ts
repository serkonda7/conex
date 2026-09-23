import { expect, type Page } from '@playwright/test'

export const e2eUsername: string = process.env.CONEX_E2E_USERNAME ?? 'e2e-user'
export const e2ePassword: string = process.env.CONEX_E2E_PASSWORD ?? 'e2e-secret-123'

/** Sign in through the UI; assumes a seeded e2e user (see tests/e2e/seed.ts). */
export async function loginAsE2E(page: Page): Promise<void> {
	await page.goto('/')
	await page.getByLabel('Username').fill(e2eUsername)
	await page.locator('input[type="password"]').fill(e2ePassword)
	await page.getByRole('button', { name: 'Sign in' }).click()
	await expect(page.getByRole('link', { name: 'Tenants' })).toBeVisible()
}

/**
 * Settle the page before a screenshot: network idle, fonts loaded, CSS
 * motion frozen, text caret hidden. Keeps baselines deterministic.
 */
export async function stabilizeForSnapshot(page: Page): Promise<void> {
	await page.waitForLoadState('networkidle')
	await page.evaluate(async () => {
		try {
			await document.fonts.ready
		} catch {
			// Fonts API unavailable — fall through to the screenshot anyway.
		}
		const style = document.createElement('style')
		style.setAttribute('data-visual-freeze', '')
		style.textContent =
			'*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}'
		document.head.appendChild(style)
	})
}
