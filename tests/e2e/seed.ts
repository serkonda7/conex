import fs from 'node:fs'
import path from 'node:path'
import { getDb, getSqliteHandle, initDb } from '../../server/src/db/connection'
import { createLocalUser, getUserByUsername } from '../../server/src/db/users'
import {
	device_types,
	devices,
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

const e2eSite = db
	.select()
	.from(sites)
	.all()
	.find((row) => row.slug === 'e2e-site')
const e2eRackType = db
	.select()
	.from(device_types)
	.all()
	.find((row) => row.model === 'E2E 10U Cabinet')
const e2eServerType = db
	.select()
	.from(device_types)
	.all()
	.find((row) => row.model === 'E2E 2U Server')
if (!e2eServerType) {
	db.insert(device_types)
		.values({ manufacturer_id: manufacturer.id, model: 'E2E 2U Server', u_height: 2 })
		.run()
} else {
	getSqliteHandle()
		.query('UPDATE device_types SET u_height = ? WHERE id = ?')
		.run(2, e2eServerType.id)
}
const e2eServer = db
	.select()
	.from(device_types)
	.all()
	.find((row) => row.model === 'E2E 2U Server')
const e2eSwitchType = db
	.select()
	.from(device_types)
	.all()
	.find((row) => row.model === 'E2E 1U Switch')
if (!e2eSwitchType) {
	db.insert(device_types)
		.values({ manufacturer_id: manufacturer.id, model: 'E2E 1U Switch', u_height: 1 })
		.run()
} else {
	getSqliteHandle()
		.query('UPDATE device_types SET u_height = ? WHERE id = ?')
		.run(1, e2eSwitchType.id)
}
const e2eSwitch = db
	.select()
	.from(device_types)
	.all()
	.find((row) => row.model === 'E2E 1U Switch')
// Shelf coverage lives in the `shelves` table (rack fixtures, fully
// separate from devices); the visual rack below mounts one.
const e2eShelfFacing = db
	.select()
	.from(device_types)
	.all()
	.find((row) => row.model === 'E2E 1U Widget')
if (!e2eShelfFacing) {
	db.insert(device_types)
		.values({ manufacturer_id: manufacturer.id, model: 'E2E 1U Widget', u_height: 1 })
		.run()
} else {
	getSqliteHandle()
		.query('UPDATE device_types SET u_height = 1 WHERE id = ?')
		.run(e2eShelfFacing.id)
}
const e2eWidgetType = db
	.select()
	.from(device_types)
	.all()
	.find((row) => row.model === 'E2E 1U Widget')
if (e2eSite && e2eRackType) {
	let visualRack = db
		.select()
		.from(racks)
		.all()
		.find((row) => row.name === 'E2E Visual Rack')
	if (!visualRack) {
		visualRack = db
			.insert(racks)
			.values({
				site_id: e2eSite.id,
				tenant_id: tenant.id,
				rack_type_id: e2eRackType.id,
				name: 'E2E Visual Rack',
				description: 'Rack for screenshot coverage.',
			})
			.returning()
			.get()
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
			const existing = db
				.select()
				.from(devices)
				.all()
				.find((row) => row.name === device.name)
			if (existing) {
				getSqliteHandle()
					.query(
						`UPDATE devices SET device_type_id = ?, site_id = ?, location_id = ?, rack_id = ?,
						face = ?, position_u = ?, status = ?, name = ?, serial = ?,
						asset_tag = ?, tenant_id = ?, description = ? WHERE id = ?`,
					)
					.run(
						values.device_type_id,
						values.site_id,
						values.location_id,
						values.rack_id,
						values.face,
						values.position_u,
						values.status,
						values.name,
						values.serial,
						values.asset_tag,
						values.tenant_id,
						values.description,
						existing.id,
					)
			} else {
				db.insert(devices).values(values).run()
			}
		}
	}
	if (e2eWidgetType) {
		const widgetValues = {
			device_type_id: e2eWidgetType.id,
			site_id: e2eSite.id,
			location_id: null,
			rack_id: null,
			face: null,
			position_u: null,
			status: 'active',
			name: 'E2E Loose Widget',
			serial: null,
			asset_tag: null,
			tenant_id: tenant.id,
			description: null,
		}
		const existingWidget = db
			.select()
			.from(devices)
			.all()
			.find((row) => row.name === 'E2E Loose Widget')
		if (existingWidget) {
			getSqliteHandle()
				.query(
					`UPDATE devices SET device_type_id = ?, site_id = ?, location_id = ?, rack_id = ?,
					face = ?, position_u = ?, status = ?, name = ?, serial = ?,
					asset_tag = ?, tenant_id = ?, description = ? WHERE id = ?`,
				)
				.run(
					widgetValues.device_type_id,
					widgetValues.site_id,
					widgetValues.location_id,
					widgetValues.rack_id,
					widgetValues.face,
					widgetValues.position_u,
					widgetValues.status,
					widgetValues.name,
					widgetValues.serial,
					widgetValues.asset_tag,
					widgetValues.tenant_id,
					widgetValues.description,
					existingWidget.id,
				)
		} else {
			db.insert(devices).values(widgetValues).run()
		}
	}
	// A shelf fixture on the visual rack: 1 HE mount at HE2 (not usable) plus
	// 2 HE reserved clearance, full depth, front face.
	if (visualRack) {
		const shelfValues = {
			rack_id: visualRack.id,
			name: 'E2E Visual Shelf',
			face: 'front',
			position_u: 2,
			mount_height: 1,
			mount_usable: 0,
			reserved_height: 2,
			is_full_depth: 1,
			description: 'Shelf for screenshot coverage.',
		}
		const existingShelf = db
			.select()
			.from(shelves)
			.all()
			.find((row) => row.name === 'E2E Visual Shelf')
		if (existingShelf) {
			getSqliteHandle()
				.query(
					`UPDATE shelves SET rack_id = ?, name = ?, face = ?, position_u = ?,
					mount_height = ?, mount_usable = ?, reserved_height = ?, is_full_depth = ?,
					description = ? WHERE id = ?`,
				)
				.run(
					shelfValues.rack_id,
					shelfValues.name,
					shelfValues.face,
					shelfValues.position_u,
					shelfValues.mount_height,
					shelfValues.mount_usable,
					shelfValues.reserved_height,
					shelfValues.is_full_depth,
					shelfValues.description,
					existingShelf.id,
				)
		} else {
			db.insert(shelves).values(shelfValues).run()
		}
	}
}

if (!getUserByUsername(username)) {
	createLocalUser(username, await Bun.password.hash(password))
}
