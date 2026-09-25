import fs from 'node:fs'
import path from 'node:path'
import { getDb, getSqliteHandle, initDb } from '../server/src/db/connection'
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
const dataDir = path.join(repoRoot, 'server', 'data')
const dbPath = path.join(dataDir, 'conex.db')

fs.mkdirSync(dataDir, { recursive: true })
initDb({ dbPath, serverRoot: path.join(repoRoot, 'server') })
const db = getDb()

// This script is intentionally destructive: it is the local demo reset command.
// Delete in dependency order so it also works when foreign keys are enabled.
getSqliteHandle().transaction(() => {
	getSqliteHandle().exec(`
		DELETE FROM cables;
		DELETE FROM interfaces;
		DELETE FROM devices;
		DELETE FROM shelves;
		DELETE FROM racks;
		DELETE FROM locations;
		DELETE FROM sites;
		DELETE FROM site_groups;
		DELETE FROM device_type_interfaces;
		DELETE FROM device_types;
		DELETE FROM manufacturers;
		DELETE FROM sessions;
		DELETE FROM auth_states;
		DELETE FROM users;
		DELETE FROM tenants;
	`)
})()

const dentist = db
	.insert(tenants)
	.values({
		name: 'Bright Smile Dental',
		slug: 'bright-smile-dental',
		description: 'Small dental practice.',
	})
	.returning()
	.get()

const dentistGroup = db
	.insert(site_groups)
	.values({ tenant_id: dentist.id, name: 'Customer Sites', slug: 'customer-sites' })
	.returning()
	.get()

const dentistSite = db
	.insert(sites)
	.values({
		tenant_id: dentist.id,
		site_group_id: dentistGroup.id,
		name: 'Bright Smile Main Office',
		slug: 'bright-smile-main-office',
		description: 'Single-location dental practice.',
		physical_address: '14 Oak Avenue, Brookfield, NY',
	})
	.returning()
	.get()

function addLocation(
	siteId: number,
	name: string,
	slug: string,
	tenantId: number | null,
	type: LocationType,
	parentId: number | null = null,
): typeof locations.$inferSelect {
	return db
		.insert(locations)
		.values({ site_id: siteId, tenant_id: tenantId, type, parent_id: parentId, name, slug })
		.returning()
		.get()
}
function addRack(
	siteId: number,
	locationId: number,
	tenantId: number | null,
	name: string,
	rackTypeId: number,
): typeof racks.$inferSelect {
	return db
		.insert(racks)
		.values({
			site_id: siteId,
			location_id: locationId,
			tenant_id: tenantId,
			rack_type_id: rackTypeId,
			name,
		})
		.returning()
		.get()
}

const dentistFloor = addLocation(
	dentistSite.id,
	'Ground Floor',
	'ground-floor',
	dentist.id,
	'floor',
)
const dentistRoom = addLocation(
	dentistSite.id,
	'IT Closet',
	'it-closet',
	dentist.id,
	'room',
	dentistFloor.id,
)
const dentistBackoffice = addLocation(
	dentistSite.id,
	'Backoffice',
	'backoffice',
	dentist.id,
	'room',
	dentistFloor.id,
)
const dentistEmpfang = addLocation(
	dentistSite.id,
	'Empfang',
	'empfang',
	dentist.id,
	'room',
	dentistFloor.id,
)
const dentistBehandlung1 = addLocation(
	dentistSite.id,
	'Behandlung 1',
	'behandlung-1',
	dentist.id,
	'room',
	dentistFloor.id,
)

const ubiquiti = db
	.insert(manufacturers)
	.values({ name: 'Ubiquiti', slug: 'ubiquiti' })
	.returning()
	.get()
const dell = db.insert(manufacturers).values({ name: 'Dell', slug: 'dell' }).returning().get()
const fortinet = db
	.insert(manufacturers)
	.values({ name: 'Fortinet', slug: 'fortinet' })
	.returning()
	.get()
const apc = db.insert(manufacturers).values({ name: 'APC', slug: 'apc' }).returning().get()
const grandstream = db
	.insert(manufacturers)
	.values({ name: 'Grandstream', slug: 'grandstream' })
	.returning()
	.get()
const generic = db
	.insert(manufacturers)
	.values({ name: 'Generic', slug: 'generic' })
	.returning()
	.get()

const switchType = db
	.insert(device_types)
	.values({
		manufacturer_id: ubiquiti.id,
		model: 'USW-Pro-24',
		u_height: 1,
	})
	.returning()
	.get()
const firewallType = db
	.insert(device_types)
	.values({
		manufacturer_id: fortinet.id,
		model: 'FortiGate 60F',
		u_height: 1,
	})
	.returning()
	.get()
const clientType = db
	.insert(device_types)
	.values({
		manufacturer_id: dell.id,
		model: 'OptiPlex Micro',
		u_height: 1,
	})
	.returning()
	.get()
const phoneSystemType = db
	.insert(device_types)
	.values({ manufacturer_id: grandstream.id, model: 'UCM6302', u_height: 1 })
	.returning()
	.get()
const powerOutletBarType = db
	.insert(device_types)
	.values({ manufacturer_id: apc.id, model: 'Basic Rack PDU 1U', u_height: 1 })
	.returning()
	.get()
const cableOrganizerType = db
	.insert(device_types)
	.values({ manufacturer_id: apc.id, model: '1U Cable Management Panel', u_height: 1 })
	.returning()
	.get()
const tiConnectorType = db
	.insert(device_types)
	.values({ manufacturer_id: generic.id, model: 'TI Connector', u_height: 1 })
	.returning()
	.get()
const cloudKeyType = db
	.insert(device_types)
	.values({ manufacturer_id: ubiquiti.id, model: 'UniFi Cloud Key Gen2', u_height: 1 })
	.returning()
	.get()
const modemType = db
	.insert(device_types)
	.values({ manufacturer_id: generic.id, model: 'Cable Modem', u_height: 1 })
	.returning()
	.get()

const rackType = db
	.insert(device_types)
	.values({
		manufacturer_id: apc.id,
		model: 'NetShelter SX 24U',
		u_height: 24,
		form_factor: '4-post cabinet',
		width: 19,
	})
	.returning()
	.get()
const dentistRack = addRack(dentistSite.id, dentistRoom.id, dentist.id, 'DENT-R01', rackType.id)

db.insert(device_type_interfaces)
	.values({ device_type_id: switchType.id, prefix: 'Port', count: 7, kind: 'ethernet' })
	.run()
db.insert(device_type_interfaces)
	.values({ device_type_id: firewallType.id, prefix: 'WAN', count: 2, kind: 'ethernet' })
	.run()
db.insert(device_type_interfaces)
	.values({ device_type_id: clientType.id, prefix: 'eth', count: 1, kind: 'ethernet' })
	.run()
db.insert(device_type_interfaces)
	.values({ device_type_id: phoneSystemType.id, prefix: 'LAN', count: 1, kind: 'ethernet' })
	.run()
db.insert(device_type_interfaces)
	.values({ device_type_id: tiConnectorType.id, prefix: 'LAN', count: 1, kind: 'ethernet' })
	.run()
db.insert(device_type_interfaces)
	.values({ device_type_id: cloudKeyType.id, prefix: 'eth', count: 1, kind: 'ethernet' })
	.run()
db.insert(device_type_interfaces)
	.values({ device_type_id: modemType.id, prefix: 'LAN', count: 1, kind: 'ethernet' })
	.run()

function addDevice(
	typeId: number,
	siteId: number,
	locationId: number,
	rackId: number | null,
	tenantId: number | null,
	name: string,
	assetTag: string,
	serial: string,
	positionU: number | null,
): typeof devices.$inferSelect {
	return db
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
		.returning()
		.get()
}

const dentistFirewall = addDevice(
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
const dentistPhoneSystem = addDevice(
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
addDevice(
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
addDevice(
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
const dentistSwitch = addDevice(
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
const dentistBackofficeClient = addDevice(
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
const dentistEmpfangClient = addDevice(
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
const dentistBehandlung1Client = addDevice(
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
const dentistTiConnector = addDevice(
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
const dentistCloudKey = addDevice(
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
const dentistModem = addDevice(
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
db.insert(shelves)
	.values({
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
	.run()
function addInterfaces(deviceId: number, names: string[]): Array<typeof interfaces.$inferSelect> {
	return names.map((name) =>
		db
			.insert(interfaces)
			.values({ device_id: deviceId, name, kind: 'ethernet' })
			.returning()
			.get(),
	)
}
const [
	dentSwitchPort,
	dentClientPort1,
	dentClientPort2,
	dentClientPort3,
	dentPhoneSystemSwitchPort,
	dentCloudKeySwitchPort,
	dentTiConnectorSwitchPort,
] = addInterfaces(dentistSwitch.id, ['Port1', 'Port2', 'Port3', 'Port4', 'Port5', 'Port6', 'Port7'])
const [dentFirewallPort, dentModemFirewallPort] = addInterfaces(dentistFirewall.id, [
	'WAN1',
	'WAN2',
])
const [dentPhoneSystemPort] = addInterfaces(dentistPhoneSystem.id, ['LAN1'])
const [dentTiConnectorPort] = addInterfaces(dentistTiConnector.id, ['LAN1'])
const [dentCloudKeyPort] = addInterfaces(dentistCloudKey.id, ['eth0'])
const [dentModemPort] = addInterfaces(dentistModem.id, ['LAN1'])
const [dentBackofficePort] = addInterfaces(dentistBackofficeClient.id, ['eth1'])
const [dentEmpfangPort] = addInterfaces(dentistEmpfangClient.id, ['eth1'])
const [dentBehandlung1Port] = addInterfaces(dentistBehandlung1Client.id, ['eth1'])

db.insert(cables)
	.values({
		a_interface_id: dentFirewallPort.id,
		b_interface_id: dentSwitchPort.id,
		kind: 'cat6a',
		label: 'Dental firewall to switch',
	})
	.run()
db.insert(cables)
	.values({
		a_interface_id: dentPhoneSystemPort.id,
		b_interface_id: dentPhoneSystemSwitchPort.id,
		kind: 'cat6a',
		label: 'Phone system to switch',
	})
	.run()
db.insert(cables)
	.values({
		a_interface_id: dentModemPort.id,
		b_interface_id: dentModemFirewallPort.id,
		kind: 'cat6a',
		label: 'Modem to firewall',
	})
	.run()
db.insert(cables)
	.values({
		a_interface_id: dentCloudKeyPort.id,
		b_interface_id: dentCloudKeySwitchPort.id,
		kind: 'cat6a',
		label: 'Cloud Key to switch',
	})
	.run()
db.insert(cables)
	.values({
		a_interface_id: dentTiConnectorPort.id,
		b_interface_id: dentTiConnectorSwitchPort.id,
		kind: 'cat6a',
		label: 'TI connector to switch',
	})
	.run()
db.insert(cables)
	.values({
		a_interface_id: dentBackofficePort.id,
		b_interface_id: dentClientPort1.id,
		kind: 'cat6a',
		label: 'Backoffice client to switch',
	})
	.run()
db.insert(cables)
	.values({
		a_interface_id: dentEmpfangPort.id,
		b_interface_id: dentClientPort2.id,
		kind: 'cat6a',
		label: 'Empfang client to switch',
	})
	.run()
db.insert(cables)
	.values({
		a_interface_id: dentBehandlung1Port.id,
		b_interface_id: dentClientPort3.id,
		kind: 'cat6a',
		label: 'Behandlung 1 client to switch',
	})
	.run()
db.insert(users)
	.values({
		username: 'demo',
		password_hash: await Bun.password.hash('demo-password'),
		provider: 'local',
		role: 'admin',
	})
	.run()

console.log(`Demo database reset at ${dbPath}`)
console.log('Login: demo / demo-password')
console.log(
	'Created 1 tenant, 1 site, 1 24U rack, 10 device models, 1 rack type, 12 devices, and 8 cables.',
)
