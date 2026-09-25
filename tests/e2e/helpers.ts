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
