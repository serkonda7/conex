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
	type PortKind,
} from 'shared/src/schemas'
import type { MessageKey } from '../../i18n'

export type ComponentClass = 'interface' | 'port' | 'power-port' | 'power-outlet' | 'display-port'

export interface ComponentClassInfo {
	key: ComponentClass
	/** Class name, used in the add menu and dialog title. */
	label: MessageKey
	/** Table heading with a `{count}` param. */
	heading: MessageKey
	/** Name placeholder of the add form. */
	placeholder: string
	/** Kinds offered by the add form; the first is the default. */
	kinds: readonly (PortKind | NetboxInterfaceType)[]
}

export const COMPONENT_CLASSES: readonly ComponentClassInfo[] = [
	{
		key: 'interface',
		label: 'deviceType.component.interface',
		heading: 'deviceType.component.interfaces',
		placeholder: 'eth',
		kinds: ['ethernet', ...(Object.keys(NETBOX_INTERFACE_TYPES) as NetboxInterfaceType[])],
	},
	{
		key: 'port',
		label: 'deviceType.component.port',
		heading: 'deviceType.component.ports',
		placeholder: 'usb',
		kinds: ['port', ...GENERAL_PORT_KINDS],
	},
	{
		key: 'power-port',
		label: 'deviceType.component.powerPort',
		heading: 'deviceType.component.powerPorts',
		placeholder: 'PSU',
		kinds: ['power'],
	},
	{
		key: 'power-outlet',
		label: 'deviceType.component.powerOutlet',
		heading: 'deviceType.component.powerOutlets',
		placeholder: 'Outlet',
		kinds: ['power-outlet'],
	},
	{
		key: 'display-port',
		label: 'deviceType.component.displayPort',
		heading: 'deviceType.component.displayPorts',
		placeholder: 'HDMI',
		kinds: DISPLAY_PORT_KINDS,
	},
]

/** Component class of a stored kind; unknown kinds are interfaces. */
export function componentClassOf(kind: string): ComponentClass {
	const match = COMPONENT_CLASSES.find(
		(c) => c.key !== 'interface' && (c.kinds as readonly string[]).includes(kind),
	)
	return match?.key ?? 'interface'
}
