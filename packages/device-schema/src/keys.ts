import { DeviceTypeYamlSchema } from './schema'

/** NetBox keys conex knows and ignores on import. */
const IGNORED_KEYS = ['weight', 'weight_unit', 'airflow', 'module-bays']

const COMPONENT_KEYS = ['name', 'type', 'description']

/** Keys of each list's entries, as `planDeviceTypePorts` reads them. */
const LIST_KEYS: Record<string, readonly string[]> = {
	interfaces: [...COMPONENT_KEYS, 'poe_mode', 'poe_type', 'mgmt_only'],
	ports: COMPONENT_KEYS,
	'console-ports': COMPONENT_KEYS,
	'power-ports': [...COMPONENT_KEYS, 'maximum_draw'],
	'power-outlets': [...COMPONENT_KEYS, 'power_port'],
	'display-ports': COMPONENT_KEYS,
	'rear-ports': [...COMPONENT_KEYS, 'positions'],
	'front-ports': [...COMPONENT_KEYS, 'positions', 'rear_port', 'rear_port_position'],
	'port-mappings': ['front_port', 'front_port_position', 'rear_port', 'rear_port_position'],
}

const TOP_LEVEL_KEYS = new Set([
	...Object.keys(DeviceTypeYamlSchema.entries),
	...IGNORED_KEYS,
	...Object.keys(LIST_KEYS),
])

/**
 * Keys conex doesn't know, as messages. A curated definition should have none,
 * though the importer ignores them: NetBox files carry many it has no use for.
 */
export function unknownDeviceTypeKeys(definition: Record<string, unknown>): string[] {
	const problems = Object.keys(definition)
		.filter((key) => !TOP_LEVEL_KEYS.has(key))
		.map((key) => `unknown key "${key}"`)
	for (const [list, keys] of Object.entries(LIST_KEYS)) {
		const entries = definition[list]
		for (const entry of Array.isArray(entries) ? entries : []) {
			for (const key of Object.keys(entry ?? {})) {
				if (!keys.includes(key)) {
					const label = entry.name ?? entry.front_port
					problems.push(`${list} "${label}": unknown key "${key}"`)
				}
			}
		}
	}
	return problems
}
