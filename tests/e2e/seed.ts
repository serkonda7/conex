import fs from 'node:fs'
import path from 'node:path'
import { SQL } from 'bun'
import { closeDb, getDb, getSqlClient, initDb } from '../../server/src/db/connection'
import { fullAccessRoleId } from '../../server/src/db/roles'
import { createLocalUser, getUserByUsername } from '../../server/src/db/users'
import {
	device_roles,
	device_types,
	devices,
	employees,
	locations,
	manufacturers,
	racks,
	shelves,
	sites,
	tenants,
} from '../../server/src/schema'

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

// Create the dedicated e2e database on first run (via the maintenance db).
const dbUrl = new URL(process.env.CONEX_DATABASE_URL ?? '')
const dbName = decodeURIComponent(dbUrl.pathname.replace(/^\//, ''))
const adminUrl = new URL(dbUrl)
adminUrl.pathname = '/postgres'
const admin = new SQL(adminUrl.toString())
if ((await admin`SELECT 1 FROM pg_database WHERE datname = ${dbName}`).length === 0) {
	await admin.unsafe(`CREATE DATABASE "${dbName.replaceAll('"', '""')}"`)
}
await admin.close()

await initDb({
	migrationsFolder: path.join(repoRoot, 'server/drizzle'),
	serverRoot: path.join(repoRoot, 'server'),
})

const db = getDb()
let tenant = (await db.select().from(tenants)).find((row) => row.name === 'E2E Tenant')
if (!tenant) {
	tenant = (await db.insert(tenants).values({ name: 'E2E Tenant' }).returning())[0]
}

const site = (await db.select().from(sites)).find((row) => row.name === 'E2E Site')
if (!site) {
	await db.insert(sites).values({ name: 'E2E Site', tenant_id: tenant.id })
}

let manufacturer = (await db.select().from(manufacturers)).find((row) => row.slug === 'e2e-maker')
if (!manufacturer) {
	manufacturer = (
		await db.insert(manufacturers).values({ name: 'E2E Maker', slug: 'e2e-maker' }).returning()
	)[0]
}
if (!(await db.select().from(device_types)).some((row) => row.model === 'E2E 42U Cabinet')) {
	await db.insert(device_types).values({
		manufacturer_id: manufacturer.id,
		model: 'E2E 42U Cabinet',
		form_factor: '4-post cabinet',
		width: 19,
		u_height: 42,
	})
} else {
	await getSqlClient()`UPDATE device_types SET manufacturer_id = ${manufacturer.id}, u_height = 42,
		is_full_depth = 1, form_factor = '4-post cabinet', width = 19, description = NULL, comments = NULL
		WHERE model = 'E2E 42U Cabinet'`
}
if (!(await db.select().from(device_types)).some((row) => row.model === 'E2E 10U Cabinet')) {
	await db.insert(device_types).values({
		manufacturer_id: manufacturer.id,
		model: 'E2E 10U Cabinet',
		form_factor: '4-post cabinet',
		width: 19,
		u_height: 10,
	})
} else {
	await getSqlClient()`UPDATE device_types SET u_height = 10, form_factor = '4-post cabinet', width = 19
		WHERE model = 'E2E 10U Cabinet'`
}

const e2eSite = (await db.select().from(sites)).find((row) => row.name === 'E2E Site')
const e2eRackType = (await db.select().from(device_types)).find(
	(row) => row.model === 'E2E 10U Cabinet',
)
const e2eServerType = (await db.select().from(device_types)).find(
	(row) => row.model === 'E2E 2U Server',
)
if (!e2eServerType) {
	await db
		.insert(device_types)
		.values({ manufacturer_id: manufacturer.id, model: 'E2E 2U Server', u_height: 2 })
} else {
	await getSqlClient()`UPDATE device_types SET u_height = 2 WHERE id = ${e2eServerType.id}`
}
const e2eServer = (await db.select().from(device_types)).find(
	(row) => row.model === 'E2E 2U Server',
)
const e2eSwitchType = (await db.select().from(device_types)).find(
	(row) => row.model === 'E2E 1U Switch',
)
if (!e2eSwitchType) {
	await db
		.insert(device_types)
		.values({ manufacturer_id: manufacturer.id, model: 'E2E 1U Switch', u_height: 1 })
} else {
	await getSqlClient()`UPDATE device_types SET u_height = 1 WHERE id = ${e2eSwitchType.id}`
}
const e2eSwitch = (await db.select().from(device_types)).find(
	(row) => row.model === 'E2E 1U Switch',
)
// Nested location tree for the locations list snapshot; parents come first.
if (e2eSite) {
	const locationTree = [
		{ name: 'E2E Floor 1', slug: 'e2e-floor-1', type: 'floor', parent: null },
		{ name: 'E2E Server Room', slug: 'e2e-server-room', type: 'room', parent: 'E2E Floor 1' },
		{ name: 'E2E Cage A', slug: 'e2e-cage-a', type: 'other', parent: 'E2E Server Room' },
		{ name: 'E2E Storage Room', slug: 'e2e-storage-room', type: 'room', parent: 'E2E Floor 1' },
		{ name: 'E2E Floor 2', slug: 'e2e-floor-2', type: 'floor', parent: null },
	] as const
	const locationIds = new Map<string, number>()
	for (const location of locationTree) {
		const values = {
			site_id: e2eSite.id,
			parent_id: location.parent ? (locationIds.get(location.parent) ?? null) : null,
			tenant_id: tenant.id,
			name: location.name,
			slug: location.slug,
			type: location.type,
			description: null,
		}
		const existing = (await db.select().from(locations)).find(
			(row) => row.name === location.name,
		)
		if (existing) {
			await getSqlClient()`UPDATE locations SET ${getSqlClient()(values)} WHERE id = ${existing.id}`
			locationIds.set(location.name, existing.id)
		} else {
			const inserted = (await db.insert(locations).values(values).returning())[0]
			locationIds.set(location.name, inserted.id)
		}
	}
}

if (e2eSite && e2eRackType) {
	let e2eRole = (await db.select().from(device_roles)).find((row) => row.name === 'E2E Role')
	if (!e2eRole) {
		e2eRole = (
			await db
				.insert(device_roles)
				.values({ name: 'E2E Role', description: 'Role for screenshot coverage.' })
				.returning()
		)[0]
	}
	let visualRack = (await db.select().from(racks)).find((row) => row.name === 'E2E Visual Rack')
	if (!visualRack) {
		visualRack = (
			await db
				.insert(racks)
				.values({
					site_id: e2eSite.id,
					tenant_id: tenant.id,
					rack_type_id: e2eRackType.id,
					name: 'E2E Visual Rack',
					description: 'Rack for screenshot coverage.',
				})
				.returning()
		)[0]
	}
	if (e2eServer && e2eSwitch) {
		const visualDevices = [
			{
				name: 'E2E Edge Server',
				device_type_id: e2eServer.id,
				position_u: 9,
				face: 'front',
			},
			{
				name: 'E2E Rack Switch',
				device_type_id: e2eSwitch.id,
				position_u: 6,
				face: 'rear',
			},
			{
				name: 'E2E Spare Device',
				device_type_id: e2eSwitch.id,
				position_u: null,
				face: null,
			},
		]
		for (const device of visualDevices) {
			const values = {
				device_type_id: device.device_type_id,
				device_role_id: e2eRole.id,
				site_id: e2eSite.id,
				location_id: null,
				rack_id: visualRack.id,
				face: device.face,
				position_u: device.position_u,
				status: 'active',
				name: device.name,
				serial: null,
				asset_tag: null,
				tenant_id: tenant.id,
				description: null,
			}
			const existing = (await db.select().from(devices)).find(
				(row) => row.name === device.name,
			)
			if (existing) {
				await getSqlClient()`UPDATE devices SET ${getSqlClient()(values)} WHERE id = ${existing.id}`
			} else {
				await db.insert(devices).values(values)
			}
		}
	}
	const shelfValues = {
		rack_id: visualRack.id,
		name: 'E2E Visual Shelf',
		face: 'front',
		position_u: 2,
		mount_height: 1,
		mount_usable: 0,
		reserved_height: 2,
		is_full_depth: 0,
		description: 'Half-depth shelf for screenshot coverage.',
	}
	const existingShelf = (await db.select().from(shelves)).find(
		(row) => row.name === shelfValues.name,
	)
	if (existingShelf) {
		await getSqlClient()`UPDATE shelves SET ${getSqlClient()(shelfValues)} WHERE id = ${existingShelf.id}`
	} else {
		await db.insert(shelves).values(shelfValues)
	}
}

// Employee with several mail addresses and phone numbers for the visual suite.
const visualEmployee: typeof employees.$inferInsert = {
	tenant_id: tenant.id,
	salutation: 'ms',
	first_name: 'Erika',
	last_name: 'E2E Visual',
	title: 'Managing director',
	emails: [
		{ address: 'erika.visual@e2e.example', scope: 'work' },
		{ address: 'erika@private.example', scope: 'private' },
	],
	phones: [
		{ number: '+49 30 1234567', type: 'phone', scope: 'work' },
		{ number: '+49 170 1234567', type: 'mobile', scope: 'work' },
		{ number: '+49 30 7654321', type: 'phone', scope: 'private' },
	],
	active: 1,
	description: 'Contact person for screenshot coverage.',
	comments: null,
}
const existingEmployee = (await db.select().from(employees)).find(
	(row) => row.last_name === visualEmployee.last_name,
)
// Recreated each run so earlier edits never leak into the baseline.
if (existingEmployee) {
	await getSqlClient()`DELETE FROM employees WHERE id = ${existingEmployee.id}`
}
await db.insert(employees).values(visualEmployee)

if (!(await getUserByUsername(username))) {
	await createLocalUser(username, await Bun.password.hash(password), await fullAccessRoleId())
}

await closeDb()
