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
} from 'shared/src/schemas'
import type { Component } from 'solid-js'
import { IconFiber, IconRj45 } from './port_icons'

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

/** Medium glyph of a port kind (copper, fiber, Wi-Fi, cellular), if it has one. */
export function portKindIcon(kind: string): IconComponent | undefined {
	if (Object.hasOwn(PASS_THROUGH_PORT_TYPES, kind)) {
		return panelKindIcon(kind)
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
