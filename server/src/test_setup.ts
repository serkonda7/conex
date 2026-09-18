import path from 'node:path'
import { initConfig } from './config'
import { initDb } from './db/connection'

/**
 * Test-only environment bootstrap: minimal config plus an in-memory SQLite
 * database with migrations applied. Both initializers are idempotent, so
 * every test file can call this without setup ordering.
 */
export function initTestEnv(): void {
	initConfig({
		auth: {
			appKey: 'test-app-key-that-is-long-enough-for-hkdf-use-0123456789',
			jwtKeyVersion: 1,
			loginRateLimit: { maxAttempts: 100, windowSeconds: 300 },
			secureCookies: false,
		},
		server: { host: '127.0.0.1', port: 0 },
		audit: { retentionDays: 90 },
	})
	initDb({
		dbPath: ':memory:',
		migrationsFolder: path.join(import.meta.dir, '../drizzle'),
	})
}
