/** Display connector kinds; like power they only connect to their own kind. */
export const DISPLAY_PORT_KINDS = ['hdmi', 'displayport', 'vga', 'dvi'] as const

/** Serial connectors (NetBox console port types); they connect to each other. */
export const SERIAL_PORT_KINDS = ['rj-45', 'de-9', 'db-25', 'rj-11', 'rj-12', 'mini-din-8'] as const

/** USB connectors (NetBox console port types); they connect to each other. */
export const USB_PORT_KINDS = [
	'usb-a',
	'usb-b',
	'usb-c',
	'usb-mini-a',
	'usb-mini-b',
	'usb-micro-a',
	'usb-micro-b',
	'usb-micro-ab',
] as const

/**
 * General-purpose port connectors (e.g. a docking station's USB-C uplink),
 * kept as the port kind. Plain `port` is a port of unknown connector.
 */
export const GENERAL_PORT_KINDS = [...SERIAL_PORT_KINDS, ...USB_PORT_KINDS] as const

/**
 * Power connectors, stored as `power-<NetBox type>`: NetBox shares type names
 * between inputs and outlets (and with data ports), yet the kind alone decides
 * a component's class. `power-dc-barrel` is a conex extension.
 */
export const POWER_INPUT_KINDS = [
	'power-iec-60320-c14',
	'power-iec-60320-c20',
	'power-iec-60320-c8',
	'power-iec-60320-c6',
	'power-ita-ef',
	'power-dc-terminal',
	'power-dc-barrel',
	'power-usb-c',
] as const

/** Outlet connectors, stored as `power-outlet-<NetBox type>`; see `POWER_INPUT_KINDS`. */
export const POWER_OUTLET_KINDS = [
	'power-outlet-iec-60320-c13',
	'power-outlet-iec-60320-c19',
	'power-outlet-iec-60320-c7',
	'power-outlet-iec-60320-c5',
	'power-outlet-ita-f',
	'power-outlet-dc-terminal',
	'power-outlet-usb-a',
	'power-outlet-usb-c',
] as const

/**
 * Common NetBox interface types with their display names. These are
 * technical identifiers, so the labels stay untranslated.
 */
export const NETBOX_INTERFACE_TYPES = {
	virtual: 'Virtual',
	bridge: 'Bridge',
	lag: 'Link Aggregation Group (LAG)',
	'100base-tx': '10/100M (100BASE-TX)',
	'1000base-t': '1G (1000BASE-T)',
	'2.5gbase-t': '2.5G (2.5GBASE-T)',
	'5gbase-t': '5G (5GBASE-T)',
	'10gbase-t': '10G (10GBASE-T)',
	'1000base-x-sfp': '1G (SFP)',
	'10gbase-x-sfpp': '10G (SFP+)',
	'25gbase-x-sfp28': '25G (SFP28)',
	'40gbase-x-qsfpp': '40G (QSFP+)',
	'50gbase-x-sfp56': '50G (SFP56)',
	'100gbase-x-qsfp28': '100G (QSFP28)',
	'200gbase-x-qsfp56': '200G (QSFP56)',
	'400gbase-x-qsfpdd': '400G (QSFP-DD)',
	'ieee802.11a': 'Wi-Fi (IEEE 802.11a, 5 GHz)',
	'ieee802.11g': 'Wi-Fi (IEEE 802.11b/g, 2.4 GHz)',
	'ieee802.11n': 'Wi-Fi 4 (IEEE 802.11n)',
	'ieee802.11ac': 'Wi-Fi 5 (IEEE 802.11ac)',
	'ieee802.11ax': 'Wi-Fi 6 (IEEE 802.11ax)',
	'ieee802.11be': 'Wi-Fi 7 (IEEE 802.11be)',
	lte: 'LTE',
	'5g': '5G',
	other: 'Other',
} as const

export type NetboxInterfaceType = keyof typeof NETBOX_INTERFACE_TYPES

/** Common and legacy port kinds; stored kinds stay free-form (including NetBox types). */
export const PORT_KINDS = [
	'ethernet',
	'port',
	...GENERAL_PORT_KINDS,
	'power',
	...POWER_INPUT_KINDS,
	'power-outlet',
	...POWER_OUTLET_KINDS,
	...DISPLAY_PORT_KINDS,
] as const

export type PortKind = (typeof PORT_KINDS)[number]

/** Interface kinds that never connect to network ports. */
export const OTHER_PORT_KINDS = new Set<string>([
	'port',
	...GENERAL_PORT_KINDS,
	'power',
	...POWER_INPUT_KINDS,
	'power-outlet',
	...POWER_OUTLET_KINDS,
	...DISPLAY_PORT_KINDS,
])

/**
 * Patch-panel pass-through sides: front ports (incoming) map onto rear
 * ports (outgoing, e.g. a wall outlet). A port without a side is a normal
 * port.
 */
export const PORT_SIDES = ['front', 'rear'] as const
export type PortSide = (typeof PORT_SIDES)[number]

/**
 * Known connector types of front and rear ports (NetBox port types) with their
 * display names. Includes legacy types for imports and existing ports. Copper
 * connectors cable like network ports, every other type only to its own kind.
 */
export const PASS_THROUGH_PORT_TYPES = {
	'8p8c': 'RJ45 (8P8C)',
	'110-punch': '110 Punch',
	lc: 'LC',
	'lc-apc': 'LC/APC',
	sc: 'SC',
	'sc-apc': 'SC/APC',
	st: 'ST',
	fc: 'FC',
	mpo: 'MPO',
	mtrj: 'MTRJ',
	splice: 'Splice',
} as const

export type PassThroughPortType = keyof typeof PASS_THROUGH_PORT_TYPES

/** Types offered for new ports; legacy types remain recognized on import and edit. */
export const SELECTABLE_PASS_THROUGH_PORT_TYPES: readonly PassThroughPortType[] = [
	'8p8c',
	'lc',
	'lc-apc',
	'sc',
	'sc-apc',
	'mpo',
	'splice',
]

/** Pass-through types that cable like network ports (copper). */
export const COPPER_PASS_THROUGH_TYPES: readonly PassThroughPortType[] = ['8p8c', '110-punch']

/** NetBox `poe_mode`: `pse` supplies power over the port, `pd` draws it. */
export const POE_MODES = ['pse', 'pd'] as const

export type PoeMode = (typeof POE_MODES)[number]

/** NetBox `poe_type`: the PoE standard of a port. */
export const POE_TYPES = [
	'type1-ieee802.3af',
	'type2-ieee802.3at',
	'type3-ieee802.3bt',
	'type4-ieee802.3bt',
] as const

export type PoeType = (typeof POE_TYPES)[number]

/** Upper bound of a power input's maximum draw, in watts. */
export const MAX_POWER_DRAW = 1_000_000

export const DEVICE_TYPE_DESCRIPTION_MAX_LENGTH = 250
