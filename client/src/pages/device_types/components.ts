/**
 * NetBox-style component classes of a device type. Each class offers its own
 * kinds in the add-component form and gets its own group on the detail page.
 * Stored kinds stay free-form (imported NetBox interface types), so anything
 * that matches no other class counts as an interface.
 */
import {
	DISPLAY_PORT_KINDS,
	NETBOX_INTERFACE_TYPES,
	type NetboxInterfaceType,
	PASS_THROUGH_PORT_TYPES,
	type PassThroughPortType,
	POWER_INPUT_KINDS,
	POWER_OUTLET_KINDS,
	type PortKind,
	type PortSide,
	SERIAL_PORT_KINDS,
	USB_PORT_KINDS,
} from 'shared/src/schemas'
import type { Component } from 'solid-js'
import { type MessageKey, t } from '../../i18n'
import {
	HdmiIcon,
	IecInletIcon,
	KeystoneIcon,
	PunchDownIcon,
	Rj45Icon,
	SchukoIcon,
	UsbAIcon,
} from './connector_icons'

export type ComponentClass =
	| 'interface'
	| 'port'
	| 'power-port'
	| 'power-outlet'
	| 'display-port'
	| 'front-port'
	| 'rear-port'

export interface ComponentClassInfo {
	key: ComponentClass
	/** Class name, used in the add menu and dialog title. */
	label: MessageKey
	/** Connector drawing in the add menu. */
	icon: Component
	/** Name placeholder of the add form. */
	placeholder: string
	/** Kinds offered by the add form; the first is the default. */
	kinds: readonly (PortKind | NetboxInterfaceType | PassThroughPortType)[]
	/** Patch-panel classes: the side their stubs get. */
	side?: PortSide
}

const PASS_THROUGH_KINDS = Object.keys(PASS_THROUGH_PORT_TYPES) as PassThroughPortType[]

const GENERIC_KINDS: Record<string, ComponentClass> = {
	port: 'port',
	power: 'power-port',
	'power-outlet': 'power-outlet',
}

export const COMPONENT_CLASSES: readonly ComponentClassInfo[] = [
	{
		key: 'interface',
		label: 'deviceType.component.interface',
		icon: Rj45Icon,
		placeholder: 'eth',
		kinds: Object.keys(NETBOX_INTERFACE_TYPES) as NetboxInterfaceType[],
	},
	{
		key: 'port',
		label: 'deviceType.component.port',
		icon: UsbAIcon,
		placeholder: 'usb',
		kinds: [...USB_PORT_KINDS, ...SERIAL_PORT_KINDS],
	},
	{
		key: 'power-port',
		label: 'deviceType.component.powerPort',
		icon: IecInletIcon,
		placeholder: 'PSU',
		kinds: POWER_INPUT_KINDS,
	},
	{
		key: 'power-outlet',
		label: 'deviceType.component.powerOutlet',
		icon: SchukoIcon,
		placeholder: 'Outlet',
		kinds: POWER_OUTLET_KINDS,
	},
	{
		key: 'display-port',
		label: 'deviceType.component.displayPort',
		icon: HdmiIcon,
		placeholder: 'HDMI',
		kinds: DISPLAY_PORT_KINDS,
	},
	{
		key: 'front-port',
		label: 'deviceType.component.frontPort',
		icon: KeystoneIcon,
		placeholder: 'Port',
		kinds: PASS_THROUGH_KINDS,
		side: 'front',
	},
	{
		key: 'rear-port',
		label: 'deviceType.component.rearPort',
		icon: PunchDownIcon,
		placeholder: 'Port',
		kinds: PASS_THROUGH_KINDS,
		side: 'rear',
	},
]

/**
 * Component class of a stored stub or port: the side decides for patch-panel
 * ports, otherwise the kind; unknown kinds are interfaces. Generic kinds (no
 * known connector, e.g. from imports) aren't offered but keep their class.
 */
export function componentClassOf(row: { kind: string; side: PortSide | null }): ComponentClass {
	if (row.side) {
		return row.side === 'front' ? 'front-port' : 'rear-port'
	}
	if (Object.hasOwn(GENERIC_KINDS, row.kind)) {
		return GENERIC_KINDS[row.kind] ?? 'interface'
	}
	const match = COMPONENT_CLASSES.find(
		(c) =>
			!c.side && c.key !== 'interface' && (c.kinds as readonly string[]).includes(row.kind),
	)
	return match?.key ?? 'interface'
}

/** Port names a stub expands to: the prefix alone, or the first and last name. */
export function stubRange(stub: { prefix: string; count: number }): string {
	return stub.count === 1
		? stub.prefix
		: t('deviceType.component.range', {
				first: `${stub.prefix}1`,
				last: `${stub.prefix}${stub.count}`,
			})
}
