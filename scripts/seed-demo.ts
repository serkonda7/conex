import path from 'node:path'
import zlib from 'node:zlib'
import { initConfig, load_config_file } from '../server/src/config'
import {
	createAttachment,
	putPlan,
	sweepAttachmentFiles,
	updateAttachment,
} from '../server/src/db/attachments'
import { closeDb, getDb, getSqlClient, initDb } from '../server/src/db/connection'
import { fullAccessRoleId } from '../server/src/db/roles'
import {
	cables,
	device_roles,
	device_type_interfaces,
	device_types,
	devices,
	interfaces,
	locations,
	manufacturers,
	racks,
	shelves,
	site_groups,
	sites,
	tenants,
	users,
} from '../server/src/schema'
import { initStorage } from '../server/src/storage'
import { getTrimmedEnv, resolveInDataDir } from '../server/src/util/server_root'
import type { DeviceRoleIcon, LocationType } from '../shared/src/schemas'

const repoRoot = path.resolve(import.meta.dir, '..')

const serverRoot = path.join(repoRoot, 'server')
// The config names the attachments directory the demo floor plan is written to.
initConfig(
	load_config_file(
		resolveInDataDir(serverRoot, getTrimmedEnv('CONEX_CONFIG_PATH') ?? 'config.toml'),
	).unwrap(),
)
await initDb({ serverRoot })
await initStorage(serverRoot)
const db = getDb()

/** First row of an insert `.returning()`; the seed cannot continue without it. */
async function one<T>(query: PromiseLike<T[]>): Promise<T> {
	const [row] = await query
	if (row === undefined) {
		throw new Error('Insert returned no row')
	}
	return row
}

// This script is intentionally destructive: it is the local demo reset command.
// Ids restart at 1 so demo URLs stay stable across resets.
await getSqlClient().unsafe(`
	TRUNCATE floorplan_placements, floorplan_areas, attachments, cables, interfaces, devices,
		shelves, racks, locations, sites, site_groups, device_type_interfaces, device_types,
		manufacturers, sessions, auth_states, users, tenants, tenant_groups, employees,
		integrations, sync_runs, external_links, object_changes, audit_log
	RESTART IDENTITY
`)
// The truncated attachments leave their files behind; the sweep removes them.
await sweepAttachmentFiles().then((result) => result.unwrap())

const dentist: typeof tenants.$inferSelect = await one(
	db
		.insert(tenants)
		.values({
			name: 'Bright Smile Dental',
			description: 'Small dental practice.',
		})
		.returning(),
)

const dentistGroup: typeof site_groups.$inferSelect = await one(
	db.insert(site_groups).values({ tenant_id: dentist.id, name: 'Customer Sites' }).returning(),
)

const dentistSite: typeof sites.$inferSelect = await one(
	db
		.insert(sites)
		.values({
			tenant_id: dentist.id,
			site_group_id: dentistGroup.id,
			name: 'Bright Smile Main Office',
			description: 'Single-location dental practice.',
			physical_street: 'Musterstraße 12',
			physical_postcode: '12345',
			physical_city: 'Musterstadt',
		})
		.returning(),
)

async function addLocation(
	siteId: number,
	name: string,
	tenantId: number | null,
	type: LocationType,
	parentId: number | null = null,
): Promise<typeof locations.$inferSelect> {
	return await one(
		db
			.insert(locations)
			.values({ site_id: siteId, tenant_id: tenantId, type, parent_id: parentId, name })
			.returning(),
	)
}
async function addRack(
	siteId: number,
	locationId: number,
	tenantId: number | null,
	name: string,
	rackTypeId: number,
): Promise<typeof racks.$inferSelect> {
	return await one(
		db
			.insert(racks)
			.values({
				site_id: siteId,
				location_id: locationId,
				tenant_id: tenantId,
				rack_type_id: rackTypeId,
				name,
			})
			.returning(),
	)
}

const dentistFloor: typeof locations.$inferSelect = await addLocation(
	dentistSite.id,
	'Ground Floor',
	dentist.id,
	'floor',
)
const dentistRoom: typeof locations.$inferSelect = await addLocation(
	dentistSite.id,
	'IT Closet',
	dentist.id,
	'room',
	dentistFloor.id,
)
const dentistBackoffice: typeof locations.$inferSelect = await addLocation(
	dentistSite.id,
	'Backoffice',
	dentist.id,
	'room',
	dentistFloor.id,
)
const dentistEmpfang: typeof locations.$inferSelect = await addLocation(
	dentistSite.id,
	'Empfang',
	dentist.id,
	'room',
	dentistFloor.id,
)
const dentistBehandlung1: typeof locations.$inferSelect = await addLocation(
	dentistSite.id,
	'Behandlung 1',
	dentist.id,
	'room',
	dentistFloor.id,
)

const ubiquiti: typeof manufacturers.$inferSelect = await one(
	db.insert(manufacturers).values({ name: 'Ubiquiti' }).returning(),
)
const dell: typeof manufacturers.$inferSelect = await one(
	db.insert(manufacturers).values({ name: 'Dell' }).returning(),
)
const fortinet: typeof manufacturers.$inferSelect = await one(
	db.insert(manufacturers).values({ name: 'Fortinet' }).returning(),
)
const apc: typeof manufacturers.$inferSelect = await one(
	db.insert(manufacturers).values({ name: 'APC' }).returning(),
)
const grandstream: typeof manufacturers.$inferSelect = await one(
	db.insert(manufacturers).values({ name: 'Grandstream' }).returning(),
)
const generic: typeof manufacturers.$inferSelect = await one(
	db.insert(manufacturers).values({ name: 'Generic' }).returning(),
)

const switchType: typeof device_types.$inferSelect = await one(
	db
		.insert(device_types)
		.values({
			manufacturer_id: ubiquiti.id,
			model: 'USW-Pro-24',
			u_height: 1,
		})
		.returning(),
)
const firewallType: typeof device_types.$inferSelect = await one(
	db
		.insert(device_types)
		.values({
			manufacturer_id: fortinet.id,
			model: 'FortiGate 60F',
			u_height: 1,
		})
		.returning(),
)
const clientType: typeof device_types.$inferSelect = await one(
	db
		.insert(device_types)
		.values({
			manufacturer_id: dell.id,
			model: 'OptiPlex Micro',
			u_height: 1,
		})
		.returning(),
)
const phoneSystemType: typeof device_types.$inferSelect = await one(
	db
		.insert(device_types)
		.values({ manufacturer_id: grandstream.id, model: 'UCM6302', u_height: 1 })
		.returning(),
)
const powerOutletBarType: typeof device_types.$inferSelect = await one(
	db
		.insert(device_types)
		.values({ manufacturer_id: apc.id, model: 'Basic Rack PDU 1U', u_height: 1 })
		.returning(),
)
const cableOrganizerType: typeof device_types.$inferSelect = await one(
	db
		.insert(device_types)
		.values({ manufacturer_id: apc.id, model: '1U Cable Management Panel', u_height: 1 })
		.returning(),
)
const tiConnectorType: typeof device_types.$inferSelect = await one(
	db
		.insert(device_types)
		.values({ manufacturer_id: generic.id, model: 'TI Connector', u_height: 1 })
		.returning(),
)
const cloudKeyType: typeof device_types.$inferSelect = await one(
	db
		.insert(device_types)
		.values({ manufacturer_id: ubiquiti.id, model: 'UniFi Cloud Key Gen2', u_height: 1 })
		.returning(),
)
const modemType: typeof device_types.$inferSelect = await one(
	db
		.insert(device_types)
		.values({ manufacturer_id: generic.id, model: 'Cable Modem', u_height: 1 })
		.returning(),
)

const rackType: typeof device_types.$inferSelect = await one(
	db
		.insert(device_types)
		.values({
			manufacturer_id: apc.id,
			model: 'NetShelter SX 24U',
			u_height: 24,
			form_factor: '4-post cabinet',
			width: 19,
		})
		.returning(),
)
const dentistRack: typeof racks.$inferSelect = await addRack(
	dentistSite.id,
	dentistRoom.id,
	dentist.id,
	'DENT-R01',
	rackType.id,
)

await db
	.insert(device_type_interfaces)
	.values({ device_type_id: switchType.id, prefix: 'Port', count: 7, kind: 'ethernet' })
await db
	.insert(device_type_interfaces)
	.values({ device_type_id: firewallType.id, prefix: 'WAN', count: 2, kind: 'ethernet' })
await db
	.insert(device_type_interfaces)
	.values({ device_type_id: clientType.id, prefix: 'eth', count: 1, kind: 'ethernet' })
await db
	.insert(device_type_interfaces)
	.values({ device_type_id: phoneSystemType.id, prefix: 'LAN', count: 1, kind: 'ethernet' })
await db
	.insert(device_type_interfaces)
	.values({ device_type_id: tiConnectorType.id, prefix: 'LAN', count: 1, kind: 'ethernet' })
await db
	.insert(device_type_interfaces)
	.values({ device_type_id: cloudKeyType.id, prefix: 'eth', count: 1, kind: 'ethernet' })
await db
	.insert(device_type_interfaces)
	.values({ device_type_id: modemType.id, prefix: 'LAN', count: 1, kind: 'ethernet' })

/**
 * Demo device role by name. `device_roles` survives the reset (the built-in
 * roles come from a migration), so an existing role is reused.
 */
async function deviceRole(name: string, icon: DeviceRoleIcon): Promise<number> {
	const row = await one(
		db
			.insert(device_roles)
			.values({ name, icon })
			.onConflictDoUpdate({ target: device_roles.name, set: { icon } })
			.returning({ id: device_roles.id }),
	)
	return row.id
}

const networkRole: number = await deviceRole('Network', 'switch')
/** Role of each demo device, by its device type. */
const roleOfType: Map<number, number> = new Map([
	[firewallType.id, await deviceRole('Firewall', 'firewall')],
	[phoneSystemType.id, await deviceRole('Phone system', 'phone')],
	[powerOutletBarType.id, await deviceRole('Power', 'ups')],
	[cableOrganizerType.id, await deviceRole('Cable management', 'patch-panel')],
	[switchType.id, networkRole],
	[clientType.id, await deviceRole('PC', 'desktop')],
	[tiConnectorType.id, await deviceRole('TI connector', 'router')],
	[cloudKeyType.id, await deviceRole('Cloud controller', 'cloud')],
	[modemType.id, await deviceRole('Modem', 'router')],
])

async function addDevice(
	typeId: number,
	siteId: number,
	locationId: number,
	rackId: number | null,
	tenantId: number | null,
	name: string,
	assetTag: string,
	serial: string,
	positionU: number | null,
): Promise<typeof devices.$inferSelect> {
	return await one(
		db
			.insert(devices)
			.values({
				device_type_id: typeId,
				device_role_id: roleOfType.get(typeId) ?? networkRole,
				site_id: siteId,
				location_id: locationId,
				rack_id: rackId,
				position_u: positionU,
				tenant_id: tenantId,
				face: positionU === null ? null : 'front',
				name,
				asset_tag: assetTag,
				serial,
			})
			.returning(),
	)
}

const dentistFirewall: typeof devices.$inferSelect = await addDevice(
	firewallType.id,
	dentistSite.id,
	dentistRoom.id,
	dentistRack.id,
	dentist.id,
	'DENT-FW-01',
	'BSD-001',
	'FGT60F-DEMO-001',
	10,
)
const dentistPhoneSystem: typeof devices.$inferSelect = await addDevice(
	phoneSystemType.id,
	dentistSite.id,
	dentistRoom.id,
	dentistRack.id,
	dentist.id,
	'DENT-PBX-01',
	'BSD-006',
	'UCM6302-DEMO-001',
	6,
)
await addDevice(
	powerOutletBarType.id,
	dentistSite.id,
	dentistRoom.id,
	dentistRack.id,
	dentist.id,
	'DENT-PDU-01',
	'BSD-007',
	'APC-PDU-DEMO-001',
	4,
)
await addDevice(
	cableOrganizerType.id,
	dentistSite.id,
	dentistRoom.id,
	dentistRack.id,
	dentist.id,
	'DENT-CABLE-MGMT-01',
	'BSD-008',
	'CM-PANEL-DEMO-001',
	2,
)
const dentistSwitch: typeof devices.$inferSelect = await addDevice(
	switchType.id,
	dentistSite.id,
	dentistRoom.id,
	dentistRack.id,
	dentist.id,
	'DENT-SW-01',
	'BSD-002',
	'USW-DEMO-001',
	8,
)
const dentistBackofficeClient: typeof devices.$inferSelect = await addDevice(
	clientType.id,
	dentistSite.id,
	dentistBackoffice.id,
	null,
	dentist.id,
	'DENT-BACKOFFICE-01',
	'BSD-003',
	'OPTIPLEX-DEMO-001',
	null,
)
const dentistEmpfangClient: typeof devices.$inferSelect = await addDevice(
	clientType.id,
	dentistSite.id,
	dentistEmpfang.id,
	null,
	dentist.id,
	'DENT-EMPFANG-01',
	'BSD-004',
	'OPTIPLEX-DEMO-002',
	null,
)
const dentistBehandlung1Client: typeof devices.$inferSelect = await addDevice(
	clientType.id,
	dentistSite.id,
	dentistBehandlung1.id,
	null,
	dentist.id,
	'DENT-BEHANDLUNG-1-01',
	'BSD-005',
	'OPTIPLEX-DEMO-003',
	null,
)
const dentistTiConnector: typeof devices.$inferSelect = await addDevice(
	tiConnectorType.id,
	dentistSite.id,
	dentistRoom.id,
	null,
	dentist.id,
	'DENT-TI-CONNECTOR-01',
	'BSD-009',
	'TI-CONNECTOR-DEMO-001',
	null,
)
const dentistCloudKey: typeof devices.$inferSelect = await addDevice(
	cloudKeyType.id,
	dentistSite.id,
	dentistRoom.id,
	null,
	dentist.id,
	'DENT-CLOUD-KEY-01',
	'BSD-010',
	'UCK-GEN2-DEMO-001',
	null,
)
const dentistModem: typeof devices.$inferSelect = await addDevice(
	modemType.id,
	dentistSite.id,
	dentistRoom.id,
	null,
	dentist.id,
	'DENT-MODEM-01',
	'BSD-011',
	'MODEM-DEMO-001',
	null,
)
// Shelf demo: a separate shelf fixture at HE12 — 1 HE mount plus 3 HE
// reserved clearance above, mount not usable, full depth.
await db.insert(shelves).values({
	rack_id: dentistRack.id,
	name: 'DENT-SHELF-01',
	face: 'front',
	position_u: 12,
	mount_height: 1,
	mount_usable: 0,
	reserved_height: 3,
	is_full_depth: 1,
	description: 'Fachboden für Modem und Cloud Key.',
})
async function addInterfaces(
	deviceId: number,
	names: string[],
): Promise<Array<typeof interfaces.$inferSelect>> {
	const rows: Array<typeof interfaces.$inferSelect> = []
	for (const name of names) {
		const [row] = await db
			.insert(interfaces)
			.values({ device_id: deviceId, name, kind: 'ethernet' })
			.returning()
		if (row) {
			rows.push(row)
		}
	}
	return rows
}
const [
	dentSwitchPort,
	dentClientPort1,
	dentClientPort2,
	dentClientPort3,
	dentPhoneSystemSwitchPort,
	dentCloudKeySwitchPort,
	dentTiConnectorSwitchPort,
]: Array<typeof interfaces.$inferSelect> = await addInterfaces(dentistSwitch.id, [
	'Port1',
	'Port2',
	'Port3',
	'Port4',
	'Port5',
	'Port6',
	'Port7',
])
const [dentFirewallPort, dentModemFirewallPort]: Array<typeof interfaces.$inferSelect> =
	await addInterfaces(dentistFirewall.id, ['WAN1', 'WAN2'])
const [dentPhoneSystemPort]: Array<typeof interfaces.$inferSelect> = await addInterfaces(
	dentistPhoneSystem.id,
	['LAN1'],
)
const [dentTiConnectorPort]: Array<typeof interfaces.$inferSelect> = await addInterfaces(
	dentistTiConnector.id,
	['LAN1'],
)
const [dentCloudKeyPort]: Array<typeof interfaces.$inferSelect> = await addInterfaces(
	dentistCloudKey.id,
	['eth0'],
)
const [dentModemPort]: Array<typeof interfaces.$inferSelect> = await addInterfaces(
	dentistModem.id,
	['LAN1'],
)
const [dentBackofficePort]: Array<typeof interfaces.$inferSelect> = await addInterfaces(
	dentistBackofficeClient.id,
	['eth1'],
)
const [dentEmpfangPort]: Array<typeof interfaces.$inferSelect> = await addInterfaces(
	dentistEmpfangClient.id,
	['eth1'],
)
const [dentBehandlung1Port]: Array<typeof interfaces.$inferSelect> = await addInterfaces(
	dentistBehandlung1Client.id,
	['eth1'],
)

await db.insert(cables).values({
	a_interface_id: dentFirewallPort.id,
	b_interface_id: dentSwitchPort.id,
	kind: 'cat6a',
	label: 'Dental firewall to switch',
})
await db.insert(cables).values({
	a_interface_id: dentPhoneSystemPort.id,
	b_interface_id: dentPhoneSystemSwitchPort.id,
	kind: 'cat6a',
	label: 'Phone system to switch',
})
await db.insert(cables).values({
	a_interface_id: dentModemPort.id,
	b_interface_id: dentModemFirewallPort.id,
	kind: 'cat6a',
	label: 'Modem to firewall',
})
await db.insert(cables).values({
	a_interface_id: dentCloudKeyPort.id,
	b_interface_id: dentCloudKeySwitchPort.id,
	kind: 'cat6a',
	label: 'Cloud Key to switch',
})
await db.insert(cables).values({
	a_interface_id: dentTiConnectorPort.id,
	b_interface_id: dentTiConnectorSwitchPort.id,
	kind: 'cat6a',
	label: 'TI connector to switch',
})
await db.insert(cables).values({
	a_interface_id: dentBackofficePort.id,
	b_interface_id: dentClientPort1.id,
	kind: 'cat6a',
	label: 'Backoffice client to switch',
})
await db.insert(cables).values({
	a_interface_id: dentEmpfangPort.id,
	b_interface_id: dentClientPort2.id,
	kind: 'cat6a',
	label: 'Empfang client to switch',
})
await db.insert(cables).values({
	a_interface_id: dentBehandlung1Port.id,
	b_interface_id: dentClientPort3.id,
	kind: 'cat6a',
	label: 'Behandlung 1 client to switch',
})
/**
 * Grayscale PNG of `width` x `height` with `draw(x, y)` as the pixel value
 * (0 black .. 255 white). Enough for a demo floor plan without an image
 * dependency.
 */
function grayPng(
	width: number,
	height: number,
	draw: (x: number, y: number) => number,
): Uint8Array {
	const crcTable = Array.from({ length: 256 }, (_, n) => {
		let c = n
		for (let k = 0; k < 8; k++) {
			c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
		}
		return c >>> 0
	})
	const crc32 = (bytes: Uint8Array): number => {
		let c = 0xffffffff
		for (const byte of bytes) {
			c = (crcTable[(c ^ byte) & 0xff] as number) ^ (c >>> 8)
		}
		return (c ^ 0xffffffff) >>> 0
	}
	const chunk = (type: string, data: Uint8Array): Buffer => {
		const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
		const out = Buffer.alloc(body.length + 8)
		out.writeUInt32BE(data.length, 0)
		body.copy(out, 4)
		out.writeUInt32BE(crc32(body), body.length + 4)
		return out
	}
	const header = Buffer.alloc(13)
	header.writeUInt32BE(width, 0)
	header.writeUInt32BE(height, 4)
	header[8] = 8 // bit depth; color type 0 (grayscale) and the rest stay 0
	const rows = Buffer.alloc((width + 1) * height)
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			rows[y * (width + 1) + 1 + x] = draw(x, y)
		}
	}
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk('IHDR', header),
		chunk('IDAT', zlib.deflateSync(rows)),
		chunk('IEND', new Uint8Array()),
	])
}

// Ground floor plan: three rooms along the top, a hallway, the treatment
// room and the waiting room below. Coordinates are normalized like the
// plan's areas, so the walls and the areas line up.
type Rect = [x0: number, y0: number, x1: number, y1: number]
const planWidth = 1200
const planHeight = 800
const rooms: Record<string, Rect> = {
	empfang: [0.04, 0.06, 0.38, 0.44],
	backoffice: [0.38, 0.06, 0.7, 0.44],
	itCloset: [0.7, 0.06, 0.96, 0.44],
	behandlung1: [0.04, 0.58, 0.5, 0.94],
	waiting: [0.5, 0.58, 0.96, 0.94],
}
const doors: Rect[] = [
	[0.17, 0.43, 0.25, 0.45],
	[0.5, 0.43, 0.58, 0.45],
	[0.79, 0.43, 0.87, 0.45],
	[0.23, 0.57, 0.31, 0.59],
	[0.69, 0.57, 0.77, 0.59],
]
const inRect = (nx: number, ny: number, [x0, y0, x1, y1]: Rect): boolean =>
	nx >= x0 && nx <= x1 && ny >= y0 && ny <= y1
const wall: number = 4 / planWidth
const groundFloorPng = grayPng(planWidth, planHeight, (x, y) => {
	const nx = x / planWidth
	const ny = y / planHeight
	const floor = inRect(nx, ny, [0.04, 0.44 + wall, 0.96, 0.58 - wall]) ? 235 : 250
	if (doors.some((door) => inRect(nx, ny, door))) {
		return floor
	}
	const onWall = Object.values(rooms).some(
		([x0, y0, x1, y1]) =>
			inRect(nx, ny, [x0 - wall, y0 - wall, x1 + wall, y1 + wall]) &&
			!inRect(nx, ny, [x0 + wall, y0 + wall, x1 - wall, y1 - wall]),
	)
	return onWall ? 40 : floor
})
const rectPoints = ([x0, y0, x1, y1]: Rect): [number, number][] => [
	[x0, y0],
	[x1, y0],
	[x1, y1],
	[x0, y1],
]
const center = ([x0, y0, x1, y1]: Rect): { x: number; y: number } => ({
	x: (x0 + x1) / 2,
	y: (y0 + y1) / 2,
})

const groundFloorPlan = (
	await createAttachment(
		{ location_id: dentistFloor.id },
		{ name: 'ground-floor.png', bytes: groundFloorPng },
		{ description: 'Ground floor plan', created_by: null },
	)
).unwrap()
await updateAttachment(groundFloorPlan.id, { is_floorplan: true }).then((result) => result.unwrap())
await putPlan(groundFloorPlan.id, {
	areas: [
		{ location_id: dentistEmpfang.id, points: rectPoints(rooms.empfang as Rect) },
		{ location_id: dentistBackoffice.id, points: rectPoints(rooms.backoffice as Rect) },
		{ location_id: dentistRoom.id, points: rectPoints(rooms.itCloset as Rect) },
		{ location_id: dentistBehandlung1.id, points: rectPoints(rooms.behandlung1 as Rect) },
	],
	placements: [
		{ rack_id: dentistRack.id, ...center(rooms.itCloset as Rect) },
		{ device_id: dentistEmpfangClient.id, ...center(rooms.empfang as Rect) },
		{ device_id: dentistBackofficeClient.id, ...center(rooms.backoffice as Rect) },
		{ device_id: dentistBehandlung1Client.id, ...center(rooms.behandlung1 as Rect) },
	],
}).then((result) => result.unwrap())

await db.insert(users).values({
	username: 'demo',
	password_hash: await Bun.password.hash('demo-password'),
	provider: 'local',
	role_id: await fullAccessRoleId(),
})

console.log('Demo database reset')
console.log('Login: demo / demo-password')
console.log(
	'Created 1 tenant, 1 site, 1 24U rack, 10 device models, 1 rack type, 12 devices, 8 cables, and 1 floor plan.',
)

await closeDb()
