/**
 * One-shot data migration from the old SQLite database to Postgres.
 *
 *   CONEX_DATABASE_URL=postgres://user:pass@host:5432/conex \
 *     bun run --cwd server db:migrate-sqlite /path/to/conex.db
 *
 * Stop the server first so the SQLite file is quiescent. The source file is
 * never modified: a snapshot is taken with `VACUUM INTO`, the snapshot is
 * brought up to the final SQLite schema with the archived migrations in
 * `server/drizzle-sqlite`, and every row is then copied into the (empty,
 * freshly migrated) Postgres database in a single transaction. Ids are kept,
 * identity sequences are advanced past them, and row counts are verified
 * before the transaction commits. Any failure leaves Postgres untouched.
 */
import { Database } from 'bun:sqlite'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { eq, getTableColumns, getTableName, sql } from 'drizzle-orm'
import { drizzle as drizzleSqlite } from 'drizzle-orm/bun-sqlite'
import { migrate as migrateSqlite } from 'drizzle-orm/bun-sqlite/migrator'
import type { PgTable } from 'drizzle-orm/pg-core'
import { closeDb, getDb, initDb } from '../src/db/connection'
import * as schema from '../src/schema'

const serverRoot = path.resolve(import.meta.dir, '..')
const BATCH_SIZE = 500

/** Insert order respects every foreign key (self-references handled per table). */
const TABLES: { table: PgTable; parentKey?: string }[] = [
	{ table: schema.tenants },
	{ table: schema.users },
	{ table: schema.sessions },
	{ table: schema.auth_states },
	{ table: schema.site_groups },
	{ table: schema.sites },
	{ table: schema.locations, parentKey: 'parent_id' },
	{ table: schema.manufacturers },
	{ table: schema.device_types },
	{ table: schema.device_type_interfaces },
	{ table: schema.device_roles },
	{ table: schema.racks },
	{ table: schema.shelves },
	{ table: schema.devices },
	{ table: schema.interfaces },
	{ table: schema.cables },
]

/**
 * Nullable columns added after the SQLite era: absent in the snapshot and
 * left NULL in Postgres. `devices.device_role_id` is required in Postgres,
 * so device rows are backfilled to a seeded `Unknown` role instead (see the
 * copy step below). `users.role_id` replaces the SQLite `role` text column
 * and is mapped onto the roles seeded by the Postgres migrations.
 */
const POSTGRES_ONLY_COLUMNS: Record<string, readonly string[]> = {
	tenants: ['tenant_group_id'],
	devices: ['device_role_id'],
	users: ['role_id'],
}

/**
 * Columns dropped after the SQLite era: present in the snapshot but absent
 * in Postgres, skipped on copy. `site_groups.parent_id` flattening turns
 * nested groups into top-level groups; globally duplicate slugs then abort
 * the migration with a unique violation instead of silently renaming.
 */
const SQLITE_ONLY_COLUMNS: Record<string, readonly string[]> = {
	site_groups: ['parent_id'],
	users: ['role'],
}

/** SQLite `users.role` value → name of the role seeded by `0012_roles.sql`. */
const LEGACY_ROLE_NAMES: Record<string, string> = {
	admin: 'Admin',
	editor: 'Editor',
	viewer: 'Viewer',
}

type Row = Record<string, unknown>

/** Expected abort; thrown inside the transaction so Postgres rolls back. */
class MigrationError extends Error {}

function fail(message: string): never {
	throw new MigrationError(message)
}

const sourcePath: string | undefined = process.argv[2]
if (!sourcePath || !fs.existsSync(sourcePath)) {
	console.error(
		sourcePath
			? `SQLite database not found at ${sourcePath}`
			: 'usage: bun run --cwd server db:migrate-sqlite <path-to-conex.db>',
	)
	process.exit(1)
}

// ---------------------------------------------------------------------------
// 1. Snapshot the SQLite file and bring the snapshot to the final schema.
// ---------------------------------------------------------------------------

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'conex-migrate-'))
const snapshotPath = path.join(workDir, 'snapshot.db')
{
	const source = new Database(sourcePath, { readonly: true })
	// Consistent copy including anything still in the WAL.
	source.run('VACUUM INTO ?', [snapshotPath])
	source.close()
}
const sqlite = new Database(snapshotPath)
try {
	// Table rebuilds in the archived migrations need FK enforcement off (drizzle
	// wraps them in a transaction, where their own PRAGMA is ignored); integrity
	// is verified with `foreign_key_check` right after.
	sqlite.exec('PRAGMA foreign_keys = OFF')
	migrateSqlite(drizzleSqlite(sqlite), {
		migrationsFolder: path.join(serverRoot, 'drizzle-sqlite'),
	})
	backfillShelfMetadata(sqlite)
	const fkViolations = sqlite.query('PRAGMA foreign_key_check').all()
	if (fkViolations.length > 0) {
		console.error(fkViolations)
		fail(`SQLite has ${fkViolations.length} foreign key violation(s); fix them first.`)
	}
	console.log(`SQLite snapshot ready (${snapshotPath})`)

	// ---------------------------------------------------------------------------
	// 2. Read and validate every table before touching Postgres.
	// ---------------------------------------------------------------------------

	const plan = TABLES.map(({ table, parentKey }) => {
		const name = getTableName(table)
		const columns = getTableColumns(table)
		const postgresOnly = new Set(POSTGRES_ONLY_COLUMNS[name] ?? [])
		const sqliteOnly = new Set(SQLITE_ONLY_COLUMNS[name] ?? [])
		const expected = new Set(
			Object.values(columns)
				.map((c) => c.name)
				.filter((c) => !postgresOnly.has(c)),
		)
		const present = new Set(
			(sqlite.query(`PRAGMA table_info("${name}")`).all() as { name: string }[]).map(
				(c) => c.name,
			),
		)
		// `device_roles` postdates the SQLite era: seed it from scratch in
		// the copy step instead of reading it from the snapshot.
		if (name === 'device_roles' && present.size === 0) {
			return { table, name, values: [], hasId: columns.id?.dataType === 'number' }
		}
		if (present.size === 0) {
			fail(`table "${name}" is missing in SQLite`)
		}
		const missing = [...expected].filter((c) => !present.has(c))
		const extra = [...present].filter((c) => !expected.has(c) && !sqliteOnly.has(c))
		if (missing.length > 0 || extra.length > 0) {
			fail(
				`column mismatch in "${name}" (missing: ${missing.join(', ') || '-'}, extra: ${extra.join(', ') || '-'})`,
			)
		}
		const keyColumn = 'id' in columns ? 'id' : Object.values(columns)[0]?.name
		let rows = sqlite.query(`SELECT * FROM "${name}" ORDER BY "${keyColumn}"`).all() as Row[]
		if (parentKey) {
			rows = parentsFirst(name, rows, parentKey)
		}
		// Drizzle inserts by property key; keys equal column names in this schema.
		const keyByColumn = new Map(Object.entries(columns).map(([key, c]) => [c.name, key]))
		const values = rows.map((row) => {
			const out: Row = {}
			for (const [column, value] of Object.entries(row)) {
				if (name === 'users' && column === 'role') {
					// Resolved to `role_id` in the copy step.
					out.role = value
					continue
				}
				if (sqliteOnly.has(column)) {
					continue
				}
				out[keyByColumn.get(column) as string] = value
			}
			return out
		})
		// Only identity ids own a sequence (session ids are opaque text).
		return { table, name, values, hasId: columns.id?.dataType === 'number' }
	})

	// ---------------------------------------------------------------------------
	// 3. Copy into Postgres in one transaction.
	// ---------------------------------------------------------------------------

	await initDb({ serverRoot })
	const db = getDb()
	for (const { table, name } of plan) {
		const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(table)
		if ((row?.n ?? 0) > 0) {
			fail(`Postgres table "${name}" is not empty; migrate into a fresh database.`)
		}
	}

	await db.transaction(async (tx) => {
		// Roles are required on every device but postdate the SQLite era:
		// seed the `Unknown` placeholder up front and point all copied
		// devices at it (they had no role before).
		let unknownRoleId: number | null = null
		for (const { table, name, values, hasId } of plan) {
			let rows = values
			if (name === 'device_roles' && values.length === 0) {
				const inserted = (
					await tx
						.insert(schema.device_roles)
						.values({
							name: 'Unknown',
							description:
								'Placeholder role for devices created before device roles existed.',
						})
						.returning({ id: schema.device_roles.id })
				)[0]
				if (!inserted) {
					fail('seeding the Unknown device role did not return an id')
				}
				unknownRoleId = (inserted as { id: number }).id
				console.log(`  ${name.padEnd(24)} 1 row (seeded)`)
				// The identity sequence already advanced past the seeded id.
				continue
			} else if (name === 'users') {
				const roleRows = await tx
					.select({ id: schema.roles.id, name: schema.roles.name })
					.from(schema.roles)
				const roleIdByName = new Map(roleRows.map((r) => [r.name, r.id]))
				rows = values.map(({ role, ...userRow }) => {
					const roleName = LEGACY_ROLE_NAMES[String(role)] ?? 'Viewer'
					const roleId = roleIdByName.get(roleName)
					if (roleId === undefined) {
						fail(`roles has no seeded "${roleName}" role to map users onto`)
					}
					return {
						...userRow,
						role_id: roleId,
						// Admins were always global.
						tenant_id: role === 'admin' ? null : userRow.tenant_id,
					}
				})
			} else if (name === 'devices') {
				if (unknownRoleId === null) {
					const existing = (
						await tx
							.select({ id: schema.device_roles.id })
							.from(schema.device_roles)
							.where(eq(schema.device_roles.name, 'Unknown'))
							.limit(1)
					)[0]
					if (!existing) {
						fail('device_roles has no Unknown role to backfill devices with')
					}
					unknownRoleId = (existing as { id: number }).id
				}
				rows = values.map((deviceRow) => ({
					...deviceRow,
					device_role_id: unknownRoleId as number,
				}))
			}
			for (let i = 0; i < rows.length; i += BATCH_SIZE) {
				try {
					await tx.insert(table).values(rows.slice(i, i + BATCH_SIZE))
				} catch (err) {
					const cause =
						err instanceof Error && err.cause instanceof Error ? err.cause : err
					const detail = (cause as { detail?: string }).detail
					fail(
						`inserting into "${name}" failed: ${cause instanceof Error ? cause.message : String(cause)}${detail ? ` (${detail})` : ''}`,
					)
				}
			}
			if (hasId) {
				await tx.execute(
					sql.raw(
						`SELECT setval(pg_get_serial_sequence('"${name}"', 'id'), GREATEST(COALESCE(MAX(id), 0), 1), MAX(id) IS NOT NULL) FROM "${name}"`,
					),
				)
			}
			const [row] = await tx.select({ n: sql<number>`count(*)::int` }).from(table)
			if (row?.n !== rows.length) {
				fail(`row count mismatch in "${name}": SQLite ${rows.length}, Postgres ${row?.n}`)
			}
			console.log(`  ${name.padEnd(24)} ${rows.length} rows`)
		}
	})
	console.log('Migration complete.')
} catch (err) {
	console.error(
		`\nMigration aborted, Postgres left unchanged: ${err instanceof Error ? err.message : err}`,
	)
	if (!(err instanceof MigrationError)) {
		console.error(err)
	}
	process.exitCode = 1
} finally {
	sqlite.close()
	fs.rmSync(workDir, { recursive: true, force: true })
	await closeDb()
}

/**
 * Orders rows so every parent precedes its children (self-referencing FKs
 * are checked per statement in Postgres).
 */
function parentsFirst(name: string, rows: Row[], parentKey: string): Row[] {
	const ordered: Row[] = []
	const placed = new Set<unknown>()
	let pending = rows
	while (pending.length > 0) {
		const next: Row[] = []
		for (const row of pending) {
			const parent = row[parentKey]
			if (parent === null || placed.has(parent)) {
				ordered.push(row)
				placed.add(row.id)
			} else {
				next.push(row)
			}
		}
		if (next.length === pending.length) {
			fail(
				`"${name}" contains a parent cycle or dangling parent (ids ${next.map((r) => r.id)})`,
			)
		}
		pending = next
	}
	return ordered
}

/**
 * Same backfill the SQLite server ran on startup: databases created by the
 * earliest shelf table lack the `name`/`description` columns.
 */
function backfillShelfMetadata(db: Database): void {
	const columns = new Set(
		(db.query('PRAGMA table_info(shelves)').all() as { name: string }[]).map((c) => c.name),
	)
	if (columns.size === 0) {
		return
	}
	if (!columns.has('name')) {
		db.exec("ALTER TABLE shelves ADD COLUMN name TEXT NOT NULL DEFAULT ''")
		db.exec("UPDATE shelves SET name = 'Fachboden HE' || position_u WHERE name = ''")
	}
	if (!columns.has('description')) {
		db.exec('ALTER TABLE shelves ADD COLUMN description TEXT')
	}
}
