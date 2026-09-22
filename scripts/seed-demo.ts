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
	rack_shelves,
	racks,
	site_groups,
	sites,
	tenants,
	users,
} from '../server/src/schema'

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
		DELETE FROM rack_shelves;
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
		description: 'Small dental practice managed by Northstar IT Services.',
	})
	.returning()
	.get()
const school = db
	.insert(tenants)
	.values({
		name: 'Maple Grove School',
		slug: 'maple-grove-school',
		description: 'Small K-8 school managed by Northstar IT Services.',
	})
	.returning()
	.get()

const dentistGroup = db
	.insert(site_groups)
	.values({ tenant_id: dentist.id, name: 'Customer Sites', slug: 'customer-sites' })
	.returning()
	.get()
const schoolGroup = db
	.insert(site_groups)
	.values({ tenant_id: school.id, name: 'Customer Sites', slug: 'customer-sites' })
	.returning()
	.get()
const mspGroup = db
	.insert(site_groups)
	.values({ name: 'Northstar Properties', slug: 'northstar-properties' })
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
const schoolSite = db
	.insert(sites)
	.values({
		tenant_id: school.id,
		site_group_id: schoolGroup.id,
		name: 'Maple Grove Campus',
		slug: 'maple-grove-campus',
		description: 'Main school campus with administration and classrooms.',
		physical_address: '88 Maple Street, Brookfield, NY',
	})
	.returning()
	.get()
const mspSite = db
	.insert(sites)
	.values({
		site_group_id: mspGroup.id,
		name: 'Northstar IT Services HQ',
		slug: 'northstar-hq',
		description: 'MSP-owned office and staging facility.',
		physical_address: '200 Commerce Drive, Brookfield, NY',
	})
	.returning()
	.get()

function addLocation(
	siteId: number,
	name: string,
	slug: string,
	tenantId: number | null,
): typeof locations.$inferSelect {
	return db
		.insert(locations)
		.values({ site_id: siteId, tenant_id: tenantId, name, slug })
		.returning()
		.get()
}
function addRack(
	siteId: number,
	locationId: number,
	tenantId: number | null,
	name: string,
	slug: string,
): typeof racks.$inferSelect {
	return db
		.insert(racks)
		.values({
			site_id: siteId,
			location_id: locationId,
			tenant_id: tenantId,
			name,
			slug,
			height_u: 12,
		})
		.returning()
		.get()
}

const dentistRoom = addLocation(dentistSite.id, 'IT Closet', 'it-closet', dentist.id)
const dentistBackoffice = addLocation(dentistSite.id, 'Backoffice', 'backoffice', dentist.id)
const dentistEmpfang = addLocation(dentistSite.id, 'Empfang', 'empfang', dentist.id)
const dentistBehandlung1 = addLocation(dentistSite.id, 'Behandlung 1', 'behandlung-1', dentist.id)
const schoolRoom = addLocation(schoolSite.id, 'Network Closet', 'network-closet', school.id)
const mspRoom = addLocation(mspSite.id, 'Staging Room', 'staging-room', null)
const dentistRack = addRack(dentistSite.id, dentistRoom.id, dentist.id, 'DENT-R01', 'dent-r01')
const schoolRack = addRack(schoolSite.id, schoolRoom.id, school.id, 'SCHOOL-R01', 'school-r01')
const mspRack = addRack(mspSite.id, mspRoom.id, null, 'MSP-R01', 'msp-r01')
const mspShelf = db
	.insert(rack_shelves)
	.values({
		rack_id: mspRack.id,
		name: 'Staging shelf',
		position_u: 1,
		height_u: 2,
		capacity_slots: 6,
	})
	.returning()
	.get()

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

const switchType = db
	.insert(device_types)
	.values({
		manufacturer_id: ubiquiti.id,
		model: 'USW-Pro-24',
		slug: 'ubiquiti-usw-pro-24',
		u_height: 1,
		form_factor: 'rack',
		width: 19,
	})
	.returning()
	.get()
const firewallType = db
	.insert(device_types)
	.values({
		manufacturer_id: fortinet.id,
		model: 'FortiGate 60F',
		slug: 'fortinet-fortigate-60f',
		u_height: 1,
		form_factor: 'desktop',
		width: 19,
	})
	.returning()
	.get()
const serverType = db
	.insert(device_types)
	.values({
		manufacturer_id: dell.id,
		model: 'PowerEdge R250',
		slug: 'dell-poweredge-r250',
		u_height: 1,
		form_factor: 'rack',
		width: 19,
	})
	.returning()
	.get()
const clientType = db
	.insert(device_types)
	.values({
		manufacturer_id: dell.id,
		model: 'OptiPlex Micro',
		slug: 'dell-optiplex-micro',
		u_height: 0,
		form_factor: 'desktop',
		width: 19,
	})
	.returning()
	.get()

db.insert(device_type_interfaces)
	.values({ device_type_id: switchType.id, prefix: 'Port', count: 4, kind: 'ethernet' })
	.run()
db.insert(device_type_interfaces)
	.values({ device_type_id: firewallType.id, prefix: 'WAN', count: 2, kind: 'ethernet' })
	.run()
db.insert(device_type_interfaces)
	.values({ device_type_id: serverType.id, prefix: 'eno', count: 2, kind: 'ethernet' })
	.run()
db.insert(device_type_interfaces)
	.values({ device_type_id: clientType.id, prefix: 'eth', count: 1, kind: 'ethernet' })
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
	shelfId: number | null = null,
): typeof devices.$inferSelect {
	return db
		.insert(devices)
		.values({
			device_type_id: typeId,
			site_id: siteId,
			location_id: locationId,
			rack_id: rackId,
			position_u: positionU,
			shelf_id: shelfId,
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
const schoolFirewall = addDevice(
	firewallType.id,
	schoolSite.id,
	schoolRoom.id,
	schoolRack.id,
	school.id,
	'SCHOOL-FW-01',
	'MGS-001',
	'FGT60F-DEMO-002',
	10,
)
const schoolSwitch = addDevice(
	switchType.id,
	schoolSite.id,
	schoolRoom.id,
	schoolRack.id,
	school.id,
	'SCHOOL-SW-01',
	'MGS-002',
	'USW-DEMO-002',
	8,
)
const schoolServer = addDevice(
	serverType.id,
	schoolSite.id,
	schoolRoom.id,
	schoolRack.id,
	school.id,
	'SCHOOL-SRV-01',
	'MGS-003',
	'R250-DEMO-001',
	5,
)
const mspFirewall = addDevice(
	firewallType.id,
	mspSite.id,
	mspRoom.id,
	mspRack.id,
	null,
	'MSP-FW-01',
	'NS-001',
	'FGT60F-DEMO-003',
	10,
)
const mspSpare = addDevice(
	serverType.id,
	mspSite.id,
	mspRoom.id,
	mspRack.id,
	null,
	'MSP-SPARE-SRV-01',
	'NS-002',
	'R250-DEMO-002',
	null,
	mspShelf.id,
)

function addInterfaces(deviceId: number, names: string[]): Array<typeof interfaces.$inferSelect> {
	return names.map((name) =>
		db
			.insert(interfaces)
			.values({ device_id: deviceId, name, kind: 'ethernet' })
			.returning()
			.get(),
	)
}
const [dentSwitchPort, dentClientPort1, dentClientPort2, dentClientPort3] = addInterfaces(
	dentistSwitch.id,
	['Port1', 'Port2', 'Port3', 'Port4'],
)
const [dentFirewallPort] = addInterfaces(dentistFirewall.id, ['WAN1', 'WAN2'])
const [schoolSwitchPort] = addInterfaces(schoolSwitch.id, ['Port1', 'Port2', 'Port3', 'Port4'])
const [schoolFirewallPort] = addInterfaces(schoolFirewall.id, ['WAN1', 'WAN2'])
const [schoolServerPort] = addInterfaces(schoolServer.id, ['eno1', 'eno2'])
addInterfaces(mspFirewall.id, ['WAN1', 'WAN2'])
addInterfaces(mspSpare.id, ['eno1', 'eno2'])
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
db.insert(cables)
	.values({
		a_interface_id: schoolFirewallPort.id,
		b_interface_id: schoolSwitchPort.id,
		kind: 'cat6a',
		label: 'School firewall to switch',
	})
	.run()
db.insert(cables)
	.values({
		a_interface_id: schoolServerPort.id,
		b_interface_id: schoolSwitchPort.id + 1,
		kind: 'cat6a',
		label: 'School server to switch',
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
	'Created 2 customer tenants, 1 MSP-owned site, 3 sites, 3 racks, 10 devices, and 6 cables.',
)
