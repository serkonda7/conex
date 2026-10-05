import fs from 'node:fs'
import path from 'node:path'
import { test as setup } from '@playwright/test'
import { e2eAuthFile, loginAsE2E } from './helpers'

/**
 * Single UI login for the whole run. Chromium tests reuse the saved
 * `storageState` (see playwright.config.ts), so they skip per-test login.
 */
setup('authenticate as e2e user', async ({ page }) => {
	await loginAsE2E(page)
	fs.mkdirSync(path.dirname(e2eAuthFile), { recursive: true })
	await page.context().storageState({ path: e2eAuthFile })
})
