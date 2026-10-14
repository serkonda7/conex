import { readFileSync } from 'node:fs'
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
	await expect(page.getByRole('link', { name: 'CoNex', exact: true })).toBeVisible()
}

// Bundled font so baselines don't depend on the host's system fonts.
const pinnedFontFamily = 'E2E Sans'
const pinnedFontDataUrl: string = `data:font/woff2;base64,${readFileSync(
	path.resolve(
		'node_modules/@fontsource-variable/noto-sans/files/noto-sans-latin-wght-normal.woff2',
	),
).toString('base64')}`

/**
 * Settle the page before a screenshot: DOM ready, fonts loaded, CSS
 * motion frozen, text caret hidden, build-info footer hidden (layout is
 * kept), UI font pinned to a bundled one. Keeps baselines deterministic.
 * Avoids `networkidle` (waits for 500ms of zero requests) — callers
 * already assert visibility of the screenshotted content first.
 */
export async function stabilizeForSnapshot(page: Page): Promise<void> {
	await page.waitForLoadState('domcontentloaded')
	await page.evaluate(
		async ({ family, fontUrl }) => {
			const style = document.createElement('style')
			style.setAttribute('data-visual-freeze', '')
			// The footer shows commit hash + build time, which change on every build.
			style.textContent =
				'*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}' +
				'.app-footer{visibility:hidden!important}' +
				`@font-face{font-family:"${family}";font-weight:100 900;src:url(${fontUrl}) format("woff2")}` +
				`body{font-family:"${family}",sans-serif!important}`
			document.head.appendChild(style)
			try {
				await document.fonts.load(`400 16px "${family}"`)
				await Promise.race([
					document.fonts.ready,
					new Promise((resolve) => setTimeout(resolve, 2000)),
				])
			} catch {
				// Fonts API unavailable — fall through to the screenshot anyway.
			}
		},
		{ family: pinnedFontFamily, fontUrl: pinnedFontDataUrl },
	)
}
