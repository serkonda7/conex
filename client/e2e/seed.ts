import fs from 'node:fs'
import path from 'node:path'
import { initDb } from '../../server/src/db/connection'
import { createLocalUser, getUserByEmail } from '../../server/src/db/users'

/**
 * E2E database seed. Runs under bun before the API webServer starts:
 * writes the e2e `config.toml` (if missing), applies migrations, and
 * provisions the login user (idempotent — reruns reuse the same DB).
 *
 * Reads `CONEX_E2E_DATA_DIR` (absolute; set by `playwright.config.ts`),
 * `CONEX_E2E_EMAIL`, `CONEX_E2E_PASSWORD`, `CONEX_E2E_API_PORT`.
 */

const dataDir: string = process.env.CONEX_E2E_DATA_DIR ?? path.resolve('test-results/e2e-data')
const email: string = process.env.CONEX_E2E_EMAIL ?? 'e2e@example.com'
const password: string = process.env.CONEX_E2E_PASSWORD ?? 'e2e-secret-123'
const apiPort: number = Number(process.env.CONEX_E2E_API_PORT ?? 3100)
const repoRoot: string = path.resolve(import.meta.dir, '../..')

fs.mkdirSync(dataDir, { recursive: true })

const configPath = path.join(dataDir, 'config.toml')
if (!fs.existsSync(configPath)) {
	fs.writeFileSync(
		configPath,
		[
			'[auth]',
			'appKey = "e2e-app-key-0123456789abcdef-0123456789abcdef"',
			'secureCookies = false',
			'',
			'[server]',
			'host = "127.0.0.1"',
			`port = ${apiPort}`,
			'',
			'[audit]',
			'retentionDays = 90',
			'',
		].join('\n'),
	)
	console.log(`wrote ${configPath}`)
}

initDb({
	dbPath: path.join(dataDir, 'e2e.db'),
	migrationsFolder: path.join(repoRoot, 'server/drizzle'),
	serverRoot: path.join(repoRoot, 'server'),
})

if (!getUserByEmail(email)) {
	createLocalUser(email, await Bun.password.hash(password))
	console.log(`created user ${email}`)
} else {
	console.log(`user ${email} exists`)
}
