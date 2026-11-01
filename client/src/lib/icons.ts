/** Glyphs for API enum values (location types, device role icons). */
import {
	IconAntennaBars5,
	IconBatteryCharging,
	IconBuilding,
	IconCloud,
	IconCube,
	IconDatabase,
	IconDesk,
	IconDeviceCctv,
	IconDeviceDesktop,
	IconDeviceLaptop,
	IconDeviceMobile,
	IconDevices2,
	IconDoor,
	IconFirewallFlame,
	IconMapPin,
	IconPhone,
	IconPlugConnected,
	IconPrinter,
	IconRouter,
	IconServer,
	IconSitemap,
	IconStack2,
	IconWifi,
} from '@tabler/icons-solidjs'
import { CELLULAR_KINDS, TRANSCEIVER_KINDS, WIFI_KINDS } from 'shared/src/ports'
import {
	COPPER_PASS_THROUGH_TYPES,
	type DeviceRoleIcon,
	type LocationType,
	PASS_THROUGH_PORT_TYPES,
	type PassThroughPortType,
	type PortKind,
} from 'shared/src/schemas'
import type { Component } from 'solid-js'
import {
	IconC5,
	IconC6,
	IconC7,
	IconC8,
	IconC13,
	IconC19,
	IconC20,
	IconDb25,
	IconDcBarrel,
	IconDcTerminal,
	IconDe9,
	IconDisplayPort,
	IconDvi,
	IconFiber,
	IconHdmi,
	IconMiniDin8,
	IconPowerInlet,
	IconRj11,
	IconRj12,
	IconRj45,
	IconSchuko,
	IconUsbA,
	IconUsbB,
	IconUsbC,
	IconUsbMicroA,
	IconUsbMicroB,
	IconUsbMiniA,
	IconUsbMiniB,
	IconVga,
} from './port_icons'

export type IconComponent = Component<{ size?: number }>

const LOCATION_TYPE_ICONS: Record<LocationType, IconComponent> = {
	building: IconBuilding,
	floor: IconStack2,
	room: IconDoor,
	desk: IconDesk,
	other: IconMapPin,
}

/** Location type glyph; unknown values get the `other` pin. */
export function locationTypeIcon(value: string): IconComponent {
	return LOCATION_TYPE_ICONS[value as LocationType] ?? IconMapPin
}

const DEVICE_ROLE_ICONS: Record<DeviceRoleIcon, IconComponent> = {
	desktop: IconDevices2,
	laptop: IconDeviceLaptop,
	server: IconServer,
	switch: IconSitemap,
	router: IconRouter,
	firewall: IconFirewallFlame,
	'access-point': IconWifi,
	storage: IconDatabase,
	printer: IconPrinter,
	phone: IconPhone,
	mobile: IconDeviceMobile,
	display: IconDeviceDesktop,
	camera: IconDeviceCctv,
	ups: IconBatteryCharging,
	'patch-panel': IconPlugConnected,
	cloud: IconCloud,
	virtual: IconCube,
}

/** Device role glyph, or `undefined` for roles without (or with an unknown) icon. */
export function deviceRoleIcon(value: string | null | undefined): IconComponent | undefined {
	return value == null ? undefined : DEVICE_ROLE_ICONS[value as DeviceRoleIcon]
}

/** Patch panel port glyph: RJ-45 for copper connectors, fiber for the rest. */
export function panelKindIcon(kind: string): IconComponent {
	return COPPER_PASS_THROUGH_TYPES.includes(kind as PassThroughPortType) ? IconRj45 : IconFiber
}

/** Connector shape of each port kind with a known connector. */
const CONNECTOR_ICONS: Record<Exclude<PortKind, 'ethernet' | 'port'>, IconComponent> = {
	'rj-45': IconRj45,
	'de-9': IconDe9,
	'db-25': IconDb25,
	'rj-11': IconRj11,
	'rj-12': IconRj12,
	'mini-din-8': IconMiniDin8,
	'usb-a': IconUsbA,
	'usb-b': IconUsbB,
	'usb-c': IconUsbC,
	'usb-mini-a': IconUsbMiniA,
	'usb-mini-b': IconUsbMiniB,
	'usb-micro-a': IconUsbMicroA,
	'usb-micro-b': IconUsbMicroB,
	'usb-micro-ab': IconUsbMicroA,
	power: IconPowerInlet,
	'power-outlet': IconSchuko,
	hdmi: IconHdmi,
	displayport: IconDisplayPort,
	vga: IconVga,
	dvi: IconDvi,
	'power-iec-60320-c14': IconPowerInlet,
	'power-iec-60320-c20': IconC20,
	'power-iec-60320-c8': IconC8,
	'power-iec-60320-c6': IconC6,
	'power-ita-ef': IconSchuko,
	'power-dc-terminal': IconDcTerminal,
	'power-dc-barrel': IconDcBarrel,
	'power-usb-c': IconUsbC,
	'power-outlet-iec-60320-c13': IconC13,
	'power-outlet-iec-60320-c19': IconC19,
	'power-outlet-iec-60320-c7': IconC7,
	'power-outlet-iec-60320-c5': IconC5,
	'power-outlet-ita-f': IconSchuko,
	'power-outlet-dc-terminal': IconDcTerminal,
	'power-outlet-usb-a': IconUsbA,
	'power-outlet-usb-c': IconUsbC,
}

/** Glyph of a port kind (connector shape or medium), if it has one. */
export function portKindIcon(kind: string): IconComponent | undefined {
	if (Object.hasOwn(PASS_THROUGH_PORT_TYPES, kind)) {
		return panelKindIcon(kind)
	}
	if (Object.hasOwn(CONNECTOR_ICONS, kind)) {
		return CONNECTOR_ICONS[kind as keyof typeof CONNECTOR_ICONS]
	}
	if (WIFI_KINDS.has(kind)) {
		return IconWifi
	}
	if (CELLULAR_KINDS.has(kind)) {
		return IconAntennaBars5
	}
	if (TRANSCEIVER_KINDS.has(kind)) {
		return IconFiber
	}
	return kind === 'ethernet' || kind.includes('base-t') ? IconRj45 : undefined
}
