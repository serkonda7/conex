import { AsyncLocalStorage } from 'node:async_hooks'
import fs from 'node:fs'
import path from 'node:path'
import { Result } from 'better-result'
import { SQL } from 'bun'
import { type BunSQLQueryResultHKT, drizzle } from 'drizzle-orm/bun-sql'
import { migrate } from 'drizzle-orm/bun-sql/migrator'
import type { PgDatabase } from 'drizzle-orm/pg-core'
import { get_server_root, getTrimmedEnv } from '../util/server_root'

/** Root handle or an open transaction; both run the same query builders. */
export type DbHandle = PgDatabase<BunSQLQueryResultHKT, Record<string, unknown>>

let dbInstance: ReturnType<typeof drizzle> | null = null
let clientInstance: SQL | null = null

/** Transaction opened by `withTransaction`, picked up by `getDb` in nested calls. */
const txStore = new AsyncLocalStorage<DbHandle>()

/**
 * Returns the initialized drizzle handle (or the surrounding
 * `withTransaction` transaction). Throws a clear error when `initDb` was
 * not called — the same shape as `getConfig`, so a missing startup step is
 * obvious instead of a `Cannot read properties of null`.
 */
export function getDb(): DbHandle {
	const tx = txStore.getStore()
	if (tx) {
		return tx
	}
	if (!dbInstance) {
		throw new Error('Database has not been initialized. Call initDb() during startup.')
	}
	return dbInstance
}

/**
 * Runs `fn` in one transaction. Service functions called inside keep using
 * `getDb()` and transparently join the transaction; a throw rolls back.
 */
export async function withTransaction<T>(fn: () => Promise<T>): Promise<T> {
	return getDb().transaction((tx) => txStore.run(tx, fn))
}

/** Raw Bun SQL client for scripts/tests needing plain SQL (server code uses `getDb`). */
export function getSqlClient(): SQL {
	if (!clientInstance) {
		throw new Error('Database has not been initialized. Call initDb() during startup.')
	}
	return clientInstance
}

export interface InitDbOptions {
	url?: string
	migrationsFolder?: string
	serverRoot?: string
}

/**
 * Connects to Postgres and runs migrations. Must be awaited once during
 * startup (or test setup) — importing this module alone opens nothing.
 * Idempotent: repeated calls return the existing handle.
 */
export async function initDb(options: InitDbOptions = {}): Promise<DbHandle> {
	if (dbInstance) {
		return dbInstance
	}

	let serverRoot = options.serverRoot
	if (!serverRoot) {
		const rootRes = get_server_root()
		if (Result.isError(rootRes)) {
			throw new Error(`Failed to initialize database: ${rootRes.error.message}`)
		}
		serverRoot = Result.unwrap(rootRes)
	}

	const migrationsFolder = options.migrationsFolder ?? path.join(serverRoot, 'drizzle')
	if (!fs.existsSync(path.join(migrationsFolder, 'meta/_journal.json'))) {
		throw new Error(`Drizzle migrations not found at ${migrationsFolder}.`)
	}

	const url = options.url ?? resolve_db_url()
	const client = new SQL(url)
	const db = drizzle({ client })
	try {
		await migrate(db, { migrationsFolder })
	} catch (err) {
		await client.close()
		throw err
	}

	dbInstance = db
	clientInstance = client
	return db
}

/** Closes the pool (scripts only; the server keeps it for its lifetime). */
export async function closeDb(): Promise<void> {
	await clientInstance?.close()
	clientInstance = null
	dbInstance = null
}

// Connection string from CONEX_DATABASE_URL, e.g.
// postgres://conex:secret@localhost:5432/conex
function resolve_db_url(): string {
	const url = getTrimmedEnv('CONEX_DATABASE_URL')
	if (!url) {
		throw new Error(
			'CONEX_DATABASE_URL is not set (e.g. postgres://user:pass@host:5432/conex).',
		)
	}
	return url
}
