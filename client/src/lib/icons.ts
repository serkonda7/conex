/** Glyphs for API enum values (location types, device role icons). */
import {
	IconAccessPoint,
	IconBatteryCharging,
	IconCloud,
	IconCube,
	IconDatabase,
	IconDeviceCctv,
	IconDeviceDesktop,
	IconDeviceLaptop,
	IconDeviceMobile,
	IconDeviceTablet,
	IconDeviceTv,
	IconDoor,
	IconMapPin,
	IconPhone,
	IconPlugConnected,
	IconPrinter,
	IconRouter,
	IconServer,
	IconShieldLock,
	IconSitemap,
	IconStack2,
} from '@tabler/icons-solidjs'
import type { DeviceRoleIcon, LocationType } from 'shared/src/schemas'
import type { Component } from 'solid-js'

export type IconComponent = Component<{ size?: number }>

const LOCATION_TYPE_ICONS: Record<LocationType, IconComponent> = {
	floor: IconStack2,
	room: IconDoor,
	other: IconMapPin,
}

/** Location type glyph; unknown values get the `other` pin. */
export function locationTypeIcon(value: string): IconComponent {
	return LOCATION_TYPE_ICONS[value as LocationType] ?? IconMapPin
}

const DEVICE_ROLE_ICONS: Record<DeviceRoleIcon, IconComponent> = {
	desktop: IconDeviceDesktop,
	laptop: IconDeviceLaptop,
	server: IconServer,
	switch: IconSitemap,
	router: IconRouter,
	firewall: IconShieldLock,
	'access-point': IconAccessPoint,
	storage: IconDatabase,
	printer: IconPrinter,
	phone: IconPhone,
	mobile: IconDeviceMobile,
	tablet: IconDeviceTablet,
	display: IconDeviceTv,
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
