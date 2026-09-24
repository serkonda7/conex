import { Database } from 'bun:sqlite'
import fs from 'node:fs'
import path from 'node:path'
import { Result } from 'better-result'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import { migrate } from 'drizzle-orm/bun-sqlite/migrator'
import { get_server_root, getTrimmedEnv, resolveInDataDir } from '../util/server_root'

export type DbHandle = ReturnType<typeof drizzle>

let dbInstance: DbHandle | null = null
let sqliteInstance: Database | null = null

/**
 * Returns the initialized drizzle handle. Throws a clear error when `initDb`
 * was not called — the same shape as `getConfig`, so a missing startup step
 * is obvious instead of a `Cannot read properties of null`.
 */
export function getDb(): DbHandle {
	if (!dbInstance) {
		throw new Error('Database has not been initialized. Call initDb() during startup.')
	}
	return dbInstance
}

/** Raw Bun SQLite handle for scripts/tests needing `.exec`/`.query` (server code uses `getDb`). */
export function getSqliteHandle(): Database {
	if (!sqliteInstance) {
		throw new Error('Database has not been initialized. Call initDb() during startup.')
	}
	return sqliteInstance
}

export interface InitDbOptions {
	dbPath?: string
	migrationsFolder?: string
	serverRoot?: string
}

/**
 * Opens the database file and runs migrations. Must be called once during
 * startup (or test setup) — importing this module alone opens nothing.
 * Idempotent: repeated calls return the existing handle.
 */
export function initDb(options: InitDbOptions = {}): DbHandle {
	if (dbInstance && sqliteInstance) {
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

	const dbPath = options.dbPath ?? resolve_db_path(serverRoot)
	if (dbPath !== ':memory:') {
		fs.mkdirSync(path.dirname(dbPath), { recursive: true })
	}
	const sqlite = new Database(dbPath, { create: true, strict: true })
	sqlite.exec('PRAGMA foreign_keys = ON')

	const db = drizzle(sqlite)
	migrate(db, { migrationsFolder })
	ensureShelfMetadataColumns(sqlite)

	dbInstance = db
	sqliteInstance = sqlite
	return db
}

/**
 * Backfills shelf metadata for databases created by the earlier shelf table,
 * which only stored rack placement. Current shelf APIs require both columns.
 */
function ensureShelfMetadataColumns(sqlite: Database): void {
	const table = sqlite
		.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'shelves'")
		.get()
	if (!table) {
		return
	}
	const columns = new Set(
		(sqlite.query('PRAGMA table_info(shelves)').all() as { name: string }[]).map(
			(column) => column.name,
		),
	)
	if (!columns.has('name')) {
		sqlite.exec("ALTER TABLE shelves ADD COLUMN name TEXT NOT NULL DEFAULT ''")
		sqlite.exec("UPDATE shelves SET name = 'Fachboden HE' || position_u WHERE name = ''")
	}
	if (!columns.has('description')) {
		sqlite.exec('ALTER TABLE shelves ADD COLUMN description TEXT')
	}
}

// Precedence for DB path:
// 1. CONEX_DB_PATH env var (`:memory:` for an in-memory DB)
// 2. conex.db
function resolve_db_path(serverRoot: string): string {
	const configured_path = getTrimmedEnv('CONEX_DB_PATH')
	if (!configured_path) {
		return path.join(serverRoot, 'data', 'conex.db')
	}

	if (configured_path === ':memory:') {
		return configured_path
	}

	return resolveInDataDir(serverRoot, configured_path)
}
