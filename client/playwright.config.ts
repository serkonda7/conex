import path from 'node:path'
import { defineConfig, devices } from '@playwright/test'

const apiPort: number = Number(process.env.CONEX_E2E_API_PORT ?? 3100)
const clientPort: number = Number(process.env.CONEX_CLIENT_PORT ?? 5372)
// Absolute so the seed script (cwd: client/) and the API (cwd: server/)
// agree on the config + database locations.
const dataDir: string = path.resolve(process.env.CONEX_E2E_DATA_DIR ?? './test-results/e2e-data')
const apiUrl: string = process.env.CONEX_E2E_API_URL ?? `http://localhost:${apiPort}`

// `CONEX_E2E_REUSE_SERVERS=1` skips the managed servers when a developer
// already runs the API + client by hand (also passed through by turbo).
const reuse: boolean = (process.env.CONEX_E2E_REUSE_SERVERS ?? '') !== ''

export default defineConfig({
	testDir: './e2e',
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
					// Seeds the e2e database (config + login user), then serves the API.
					command: 'bun ./e2e/seed.ts && cd ../server && bun src/index.ts',
					env: {
						CONEX_E2E_API_PORT: String(apiPort),
						CONEX_E2E_DATA_DIR: dataDir,
						CONEX_E2E_EMAIL: process.env.CONEX_E2E_EMAIL ?? 'e2e@example.com',
						CONEX_E2E_PASSWORD: process.env.CONEX_E2E_PASSWORD ?? 'e2e-secret-123',
						CONEX_CONFIG_PATH: path.join(dataDir, 'config.toml'),
						CONEX_DB_PATH: path.join(dataDir, 'e2e.db'),
						CONEX_PORT: String(apiPort),
					},
					url: `${apiUrl}/health`,
					reuseExistingServer: true,
					timeout: 60_000,
				},
				{
					command: 'bunx vite',
					env: {
						CONEX_CLIENT_PORT: String(clientPort),
						CONEX_API_URL: apiUrl,
					},
					url: process.env.CONEX_E2E_BASE_URL ?? `http://localhost:${clientPort}`,
					reuseExistingServer: true,
					timeout: 60_000,
				},
			],
	projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
