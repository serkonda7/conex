import path from 'node:path'
import { defineConfig, devices } from '@playwright/test'

// Keep E2E services separate from the normal client (5371) and API (3000).
const clientPort: number = Number(process.env.CONEX_CLIENT_PORT ?? 5372)
const dataDir: string = path.resolve(process.env.CONEX_E2E_DATA_DIR ?? './test-results/e2e-data')
const apiUrl: string = process.env.CONEX_E2E_API_URL ?? 'http://localhost:3300'
const apiPort: number = Number(new URL(apiUrl).port || 3300)
const reuse: boolean = (process.env.CONEX_E2E_REUSE_SERVERS ?? '') !== ''
export const e2eAuthFile: string = path.resolve('./test-results/.auth/user.json')

// Dedicated database: the seed writes fixtures into it. Defaults to
// `<CONEX_DATABASE_URL db>_e2e` on the same server; the seed creates it if missing.
function resolve_e2e_db_url(): string {
	const explicit = process.env.CONEX_E2E_DATABASE_URL?.trim()
	if (explicit) {
		return explicit
	}
	const base = process.env.CONEX_DATABASE_URL?.trim()
	if (!base) {
		throw new Error(
			'Set CONEX_E2E_DATABASE_URL or CONEX_DATABASE_URL (e.g. postgres://user:pass@host:5432/conex) to run e2e tests.',
		)
	}
	const url = new URL(base)
	url.pathname = `${url.pathname.replace(/^\//, '') || 'conex'}_e2e`
	return url.toString()
}

export default defineConfig({
	testDir: './tests/e2e',
	timeout: 60_000,
	retries: 0,
	fullyParallel: true,
	workers: process.env.CI ? 4 : undefined,
	// Visual baselines are Linux-CI canonical at 1920x1080. Regenerate with
	// `bun run test:visual:update` and review the PNG diff before committing.
	snapshotPathTemplate: './tests/e2e/__snapshots__/{testFileName}/{arg}-{projectName}{ext}',
	expect: {
		toHaveScreenshot: {
			maxDiffPixels: 100,
			threshold: 0.2,
			animations: 'disabled',
		},
	},
	use: {
		baseURL: process.env.CONEX_E2E_BASE_URL ?? `http://localhost:${clientPort}`,
		trace: 'retain-on-failure',
		screenshot: 'only-on-failure',
		viewport: { width: 1920, height: 1080 },
		deviceScaleFactor: 1,
		colorScheme: 'dark',
	},
	webServer: reuse
		? undefined
		: [
				{
					command: 'bun ./tests/e2e/seed.ts && cd server && bun src/index.ts',
					env: {
						CONEX_E2E_DATA_DIR: dataDir,
						CONEX_CONFIG_PATH: path.join(dataDir, 'config.toml'),
						CONEX_DATABASE_URL: resolve_e2e_db_url(),
						CONEX_SERVER_PORT: String(apiPort),
					},
					url: `${apiUrl}/health`,
					reuseExistingServer: true,
					timeout: 60_000,
				},
				{
					command: 'cd client && bunx vite',
					env: { CONEX_CLIENT_PORT: String(clientPort), CONEX_API_URL: apiUrl },
					url: process.env.CONEX_E2E_BASE_URL ?? `http://localhost:${clientPort}`,
					reuseExistingServer: true,
					timeout: 60_000,
				},
			],
	projects: [
		{ name: 'setup', testMatch: /.*\.setup\.ts/ },
		{
			// Functional suite (`bun run test:e2e`); visual baselines run
			// separately as the `visual` project (`bun run test:visual`).
			name: 'chromium',
			testIgnore: /visual\.test\.ts/,
			use: {
				...devices['Desktop Chrome'],
				viewport: { width: 1920, height: 1080 },
				storageState: e2eAuthFile,
			},
			dependencies: ['setup'],
		},
		{
			name: 'visual',
			testMatch: /visual\.test\.ts/,
			use: {
				...devices['Desktop Chrome'],
				viewport: { width: 1920, height: 1080 },
				storageState: e2eAuthFile,
			},
			dependencies: ['setup'],
		},
	],
})
