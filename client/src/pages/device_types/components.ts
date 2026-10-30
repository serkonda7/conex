/**
 * NetBox-style component classes of a device type. Each class offers its own
 * kinds in the add-component form and gets its own table on the detail page.
 * Stored kinds stay free-form (imported NetBox interface types), so anything
 * that matches no other class counts as an interface.
 */
import {
	DISPLAY_PORT_KINDS,
	GENERAL_PORT_KINDS,
	NETBOX_INTERFACE_TYPES,
	type NetboxInterfaceType,
	PASS_THROUGH_PORT_TYPES,
	type PassThroughPortType,
	type PortKind,
	type PortSide,
} from 'shared/src/schemas'
import type { Component } from 'solid-js'
import type { MessageKey } from '../../i18n'
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
	/** Table heading with a `{count}` param. */
	heading: MessageKey
	/** Hover hint in the add menu: the connector's front view. */
	icon: Component
	/** Name placeholder of the add form. */
	placeholder: string
	/** Kinds offered by the add form; the first is the default. */
	kinds: readonly (PortKind | NetboxInterfaceType | PassThroughPortType)[]
	/** Patch-panel classes: the side their stubs get. */
	side?: PortSide
}

const PASS_THROUGH_KINDS = Object.keys(PASS_THROUGH_PORT_TYPES) as PassThroughPortType[]

export const COMPONENT_CLASSES: readonly ComponentClassInfo[] = [
	{
		key: 'interface',
		label: 'deviceType.component.interface',
		heading: 'deviceType.component.interfaces',
		icon: Rj45Icon,
		placeholder: 'eth',
		kinds: ['ethernet', ...(Object.keys(NETBOX_INTERFACE_TYPES) as NetboxInterfaceType[])],
	},
	{
		key: 'port',
		label: 'deviceType.component.port',
		heading: 'deviceType.component.ports',
		icon: UsbAIcon,
		placeholder: 'usb',
		kinds: ['port', ...GENERAL_PORT_KINDS],
	},
	{
		key: 'power-port',
		label: 'deviceType.component.powerPort',
		heading: 'deviceType.component.powerPorts',
		icon: IecInletIcon,
		placeholder: 'PSU',
		kinds: ['power'],
	},
	{
		key: 'power-outlet',
		label: 'deviceType.component.powerOutlet',
		heading: 'deviceType.component.powerOutlets',
		icon: SchukoIcon,
		placeholder: 'Outlet',
		kinds: ['power-outlet'],
	},
	{
		key: 'display-port',
		label: 'deviceType.component.displayPort',
		heading: 'deviceType.component.displayPorts',
		icon: HdmiIcon,
		placeholder: 'HDMI',
		kinds: DISPLAY_PORT_KINDS,
	},
	{
		key: 'front-port',
		label: 'deviceType.component.frontPort',
		heading: 'deviceType.component.frontPorts',
		icon: KeystoneIcon,
		placeholder: 'Port',
		kinds: PASS_THROUGH_KINDS,
		side: 'front',
	},
	{
		key: 'rear-port',
		label: 'deviceType.component.rearPort',
		heading: 'deviceType.component.rearPorts',
		icon: PunchDownIcon,
		placeholder: 'Port',
		kinds: PASS_THROUGH_KINDS,
		side: 'rear',
	},
]

/**
 * Component class of a stored stub or port: the side decides for patch-panel
 * ports, otherwise the kind; unknown kinds are interfaces.
 */
export function componentClassOf(row: { kind: string; side: PortSide | null }): ComponentClass {
	if (row.side) {
		return row.side === 'front' ? 'front-port' : 'rear-port'
	}
	const match = COMPONENT_CLASSES.find(
		(c) =>
			!c.side && c.key !== 'interface' && (c.kinds as readonly string[]).includes(row.kind),
	)
	return match?.key ?? 'interface'
}
