import path from 'node:path'
import { closeDb, getDb, getSqlClient, initDb } from '../server/src/db/connection'
import {
	cables,
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
import type { LocationType } from '../shared/src/schemas'

const repoRoot = path.resolve(import.meta.dir, '..')

await initDb({ serverRoot: path.join(repoRoot, 'server') })
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
	TRUNCATE cables, interfaces, devices, shelves, racks, locations, sites, site_groups,
		device_type_interfaces, device_types, manufacturers, sessions, auth_states, users, tenants,
		tenant_groups
	RESTART IDENTITY
`)

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
	db
		.insert(site_groups)
		.values({ tenant_id: dentist.id, name: 'Customer Sites', slug: 'customer-sites' })
		.returning(),
)

const dentistSite: typeof sites.$inferSelect = await one(
	db
		.insert(sites)
		.values({
			tenant_id: dentist.id,
			site_group_id: dentistGroup.id,
			name: 'Bright Smile Main Office',
			slug: 'bright-smile-main-office',
			description: 'Single-location dental practice.',
			physical_address: '14 Oak Avenue, Brookfield, NY',
		})
		.returning(),
)

async function addLocation(
	siteId: number,
	name: string,
	slug: string,
	tenantId: number | null,
	type: LocationType,
	parentId: number | null = null,
): Promise<typeof locations.$inferSelect> {
	return await one(
		db
			.insert(locations)
			.values({ site_id: siteId, tenant_id: tenantId, type, parent_id: parentId, name, slug })
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
	'ground-floor',
	dentist.id,
	'floor',
)
const dentistRoom: typeof locations.$inferSelect = await addLocation(
	dentistSite.id,
	'IT Closet',
	'it-closet',
	dentist.id,
	'room',
	dentistFloor.id,
)
const dentistBackoffice: typeof locations.$inferSelect = await addLocation(
	dentistSite.id,
	'Backoffice',
	'backoffice',
	dentist.id,
	'room',
	dentistFloor.id,
)
const dentistEmpfang: typeof locations.$inferSelect = await addLocation(
	dentistSite.id,
	'Empfang',
	'empfang',
	dentist.id,
	'room',
	dentistFloor.id,
)
const dentistBehandlung1: typeof locations.$inferSelect = await addLocation(
	dentistSite.id,
	'Behandlung 1',
	'behandlung-1',
	dentist.id,
	'room',
	dentistFloor.id,
)

const ubiquiti: typeof manufacturers.$inferSelect = await one(
	db.insert(manufacturers).values({ name: 'Ubiquiti', slug: 'ubiquiti' }).returning(),
)
const dell: typeof manufacturers.$inferSelect = await one(
	db.insert(manufacturers).values({ name: 'Dell', slug: 'dell' }).returning(),
)
const fortinet: typeof manufacturers.$inferSelect = await one(
	db.insert(manufacturers).values({ name: 'Fortinet', slug: 'fortinet' }).returning(),
)
const apc: typeof manufacturers.$inferSelect = await one(
	db.insert(manufacturers).values({ name: 'APC', slug: 'apc' }).returning(),
)
const grandstream: typeof manufacturers.$inferSelect = await one(
	db.insert(manufacturers).values({ name: 'Grandstream', slug: 'grandstream' }).returning(),
)
const generic: typeof manufacturers.$inferSelect = await one(
	db.insert(manufacturers).values({ name: 'Generic', slug: 'generic' }).returning(),
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
await db.insert(users).values({
	username: 'demo',
	password_hash: await Bun.password.hash('demo-password'),
	provider: 'local',
	role: 'admin',
})

console.log('Demo database reset')
console.log('Login: demo / demo-password')
console.log(
	'Created 1 tenant, 1 site, 1 24U rack, 10 device models, 1 rack type, 12 devices, and 8 cables.',
)

await closeDb()
