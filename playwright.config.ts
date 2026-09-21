import path from 'node:path'
import { defineConfig, devices } from '@playwright/test'

const clientPort: number = Number(process.env.CONEX_CLIENT_PORT ?? 5372)
const dataDir: string = path.resolve(process.env.CONEX_E2E_DATA_DIR ?? './test-results/e2e-data')
const apiUrl: string = process.env.CONEX_E2E_API_URL ?? 'http://localhost:3000'
const reuse: boolean = (process.env.CONEX_E2E_REUSE_SERVERS ?? '') !== ''

export default defineConfig({
	testDir: './tests/e2e',
	timeout: 60_000,
	retries: 0,
	use: {
		baseURL: process.env.CONEX_E2E_BASE_URL ?? `http://localhost:${clientPort}`,
		trace: 'retain-on-failure',
	},
	webServer: reuse
		? undefined
		: [
				{
					command: 'bun ./tests/e2e/seed.ts && cd server && bun src/index.ts',
					env: {
						CONEX_E2E_DATA_DIR: dataDir,
						CONEX_CONFIG_PATH: path.join(dataDir, 'config.toml'),
						CONEX_DB_PATH: path.join(dataDir, 'e2e.db'),
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
	projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
