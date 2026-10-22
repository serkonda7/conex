import {
	COPPER_PASS_THROUGH_TYPES,
	DISPLAY_PORT_KINDS,
	GENERAL_PORT_KINDS,
	NETBOX_INTERFACE_TYPES,
	PASS_THROUGH_PORT_TYPES,
	type PortSide,
	SERIAL_PORT_KINDS,
	USB_PORT_KINDS,
} from './schemas'

/** Interface kinds that never connect to network ports. */
export const OTHER_PORT_KINDS = new Set<string>([
	'port',
	...GENERAL_PORT_KINDS,
	'power',
	'power-outlet',
	...DISPLAY_PORT_KINDS,
])

const POWER_PORT_KINDS = new Set(['power', 'power-outlet'])

/** Patch-panel connectors (fiber, …) that only cable to their own kind; copper cables like ethernet. */
const SAME_KIND_PASS_THROUGH = new Set<string>(
	Object.keys(PASS_THROUGH_PORT_TYPES).filter(
		(k) => !(COPPER_PASS_THROUGH_TYPES as readonly string[]).includes(k),
	),
)

/** Transceiver interfaces (SFP, QSFP, …); fiber patch-panel ports cable to them. */
const TRANSCEIVER_KINDS = new Set<string>(
	Object.keys(NETBOX_INTERFACE_TYPES).filter((k) => k.includes('sfp')),
)

/** Wireless interface families; they only pair within their own family, never with wired ports. */
const WIRELESS_FAMILIES = [
	new Set<string>(Object.keys(NETBOX_INTERFACE_TYPES).filter((k) => k.startsWith('ieee802.11'))),
	new Set<string>(['lte', '5g']),
]

/** Connector families cabled across connectors (rollover, USB-A to USB-C, …). */
const PORT_FAMILIES = [new Set<string>(SERIAL_PORT_KINDS), new Set<string>(USB_PORT_KINDS)]

/** The port fields compatibility depends on. */
export interface PortShape {
	id: number
	kind: string
	side: PortSide | null
	rear_port_id: number | null
}

/** Pass-through group of a panel port (its rear port's id); see `server/src/db/cables.ts`. */
export function passThroughGroup(port: PortShape): number | null {
	if (port.side === 'rear') {
		return port.id
	}
	return port.side === 'front' ? port.rear_port_id : null
}

function isGeneralPort(kind: string): boolean {
	return kind === 'port' || (GENERAL_PORT_KINDS as readonly string[]).includes(kind)
}

/**
 * Wired network ports pair with wired network ports, wireless ones only within
 * their family (WLAN, cellular); a power port pairs with a power port
 * or outlet (never outlet to outlet); general ports pair within their
 * connector family, a plain `port` with any general port; display only with
 * the same kind; fiber panel ports with the same kind or a transceiver (SFP, …).
 */
export function portKindsCompatible(local: string, peer: string): boolean {
	if (SAME_KIND_PASS_THROUGH.has(local) || SAME_KIND_PASS_THROUGH.has(peer)) {
		return local === peer || TRANSCEIVER_KINDS.has(local) || TRANSCEIVER_KINDS.has(peer)
	}
	if (WIRELESS_FAMILIES.some((f) => f.has(local) || f.has(peer))) {
		return WIRELESS_FAMILIES.some((f) => f.has(local) && f.has(peer))
	}
	if (POWER_PORT_KINDS.has(local) && POWER_PORT_KINDS.has(peer)) {
		return local === 'power' || peer === 'power'
	}
	if (isGeneralPort(local) && isGeneralPort(peer)) {
		return (
			local === 'port' ||
			peer === 'port' ||
			PORT_FAMILIES.some((f) => f.has(local) && f.has(peer))
		)
	}
	if (OTHER_PORT_KINDS.has(local) || OTHER_PORT_KINDS.has(peer)) {
		return local === peer
	}
	return true
}

/** Kinds compatible, and not two ports of one pass-through. */
export function portsCompatible(local: PortShape, peer: PortShape): boolean {
	const group = passThroughGroup(local)
	if (group !== null && group === passThroughGroup(peer)) {
		return false
	}
	return portKindsCompatible(local.kind, peer.kind)
}
