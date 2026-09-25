import path from 'node:path'
import { expect, type Page } from '@playwright/test'

export const e2eUsername: string = process.env.CONEX_E2E_USERNAME ?? 'e2e-user'
export const e2ePassword: string = process.env.CONEX_E2E_PASSWORD ?? 'e2e-secret-123'
// Must match `e2eAuthFile` in playwright.config.ts (resolved from repo root).
export const e2eAuthFile: string = path.resolve('test-results/.auth/user.json')

/** Sign in through the UI; assumes a seeded e2e user (see tests/e2e/seed.ts). */
export async function loginAsE2E(page: Page): Promise<void> {
	await page.goto('/')
	await page.getByLabel('Benutzername').fill(e2eUsername)
	await page.locator('input[type="password"]').fill(e2ePassword)
	await page.getByRole('button', { name: 'Anmelden' }).click()
	await expect(page.getByRole('link', { name: 'Mandanten' })).toBeVisible()
}

/**
 * Settle the page before a screenshot: DOM ready, fonts loaded, CSS
 * motion frozen, text caret hidden. Keeps baselines deterministic.
 * Avoids `networkidle` (waits for 500ms of zero requests) — callers
 * already assert visibility of the screenshotted content first.
 */
export async function stabilizeForSnapshot(page: Page): Promise<void> {
	await page.waitForLoadState('domcontentloaded')
	await page.evaluate(async () => {
		try {
			await Promise.race([
				document.fonts.ready,
				new Promise((resolve) => setTimeout(resolve, 2000)),
			])
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
