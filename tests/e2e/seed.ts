import fs from 'node:fs'
import path from 'node:path'
import { getDb, getSqliteHandle, initDb } from '../../server/src/db/connection'
import { createLocalUser, getUserByUsername } from '../../server/src/db/users'
import { device_types, manufacturers, sites, tenants } from '../../server/src/schema'

const dataDir: string = process.env.CONEX_E2E_DATA_DIR ?? path.resolve('test-results/e2e-data')
const username: string = process.env.CONEX_E2E_USERNAME ?? 'e2e-user'
const password: string = process.env.CONEX_E2E_PASSWORD ?? 'e2e-secret-123'
const repoRoot: string = path.resolve(import.meta.dir, '../..')

fs.mkdirSync(dataDir, { recursive: true })
const configPath = path.join(dataDir, 'config.toml')
if (!fs.existsSync(configPath)) {
	fs.writeFileSync(
		configPath,
		'[auth]\nappKey = "e2e-app-key-0123456789abcdef-0123456789abcdef"\nsecureCookies = false\n',
	)
}

initDb({
	dbPath: path.join(dataDir, 'e2e.db'),
	migrationsFolder: path.join(repoRoot, 'server/drizzle'),
	serverRoot: path.join(repoRoot, 'server'),
})

const db = getDb()
let tenant = db
	.select()
	.from(tenants)
	.all()
	.find((row) => row.slug === 'e2e-tenant')
if (!tenant) {
	tenant = db.insert(tenants).values({ name: 'E2E Tenant', slug: 'e2e-tenant' }).returning().get()
}

const site = db
	.select()
	.from(sites)
	.all()
	.find((row) => row.slug === 'e2e-site')
if (!site) {
	db.insert(sites).values({ name: 'E2E Site', slug: 'e2e-site', tenant_id: tenant.id }).run()
}

let manufacturer = db
	.select()
	.from(manufacturers)
	.all()
	.find((row) => row.slug === 'e2e-maker')
if (!manufacturer) {
	manufacturer = db
		.insert(manufacturers)
		.values({ name: 'E2E Maker', slug: 'e2e-maker' })
		.returning()
		.get()
}
if (
	!db
		.select()
		.from(device_types)
		.all()
		.some((row) => row.model === 'E2E 42U Cabinet')
) {
	db.insert(device_types)
		.values({
			manufacturer_id: manufacturer.id,
			model: 'E2E 42U Cabinet',
			form_factor: '4-post cabinet',
			width: 19,
			u_height: 42,
		})
		.run()
} else {
	getSqliteHandle()
		.query('UPDATE device_types SET u_height = 42, form_factor = ?, width = 19 WHERE model = ?')
		.run('4-post cabinet', 'E2E 42U Cabinet')
}
if (
	!db
		.select()
		.from(device_types)
		.all()
		.some((row) => row.model === 'E2E 10U Cabinet')
) {
	db.insert(device_types)
		.values({
			manufacturer_id: manufacturer.id,
			model: 'E2E 10U Cabinet',
			form_factor: '4-post cabinet',
			width: 19,
			u_height: 10,
		})
		.run()
} else {
	getSqliteHandle()
		.query('UPDATE device_types SET u_height = 10, form_factor = ?, width = 19 WHERE model = ?')
		.run('4-post cabinet', 'E2E 10U Cabinet')
}

if (!getUserByUsername(username)) {
	createLocalUser(username, await Bun.password.hash(password))
}
