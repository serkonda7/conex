/**
 * Localized display labels for API enum values. The raw values stay the
 * wire format; only what the user sees goes through the dictionaries.
 * Row types carry most enums as plain strings, so every label helper
 * accepts any string and falls back to the raw value for unknown ones.
 */
import { LOCATION_TYPES, type LocationType } from 'shared/src/schemas'
import type { RackFormFactor } from '../api_templates'
import type { UserRole } from '../api_users'
import { type MessageKey, t } from '.'

function lookup(keys: Record<string, MessageKey>, value: string): string {
	const key = keys[value]
	return key ? t(key) : value
}

const FORM_FACTOR_KEYS: Record<RackFormFactor, MessageKey> = {
	'2-post frame': 'formFactor.twoPostFrame',
	'4-post frame': 'formFactor.fourPostFrame',
	'4-post cabinet': 'formFactor.fourPostCabinet',
	'wall-mounted frame': 'formFactor.wallFrame',
	'wall-mounted cabinet': 'formFactor.wallCabinet',
}

/** Rack form factor (`4-post cabinet`, …). */
export function formFactorLabel(value: string): string {
	return lookup(FORM_FACTOR_KEYS, value)
}

const FACE_KEYS: Record<'front' | 'rear', MessageKey> = {
	front: 'face.front',
	rear: 'face.rear',
}

/** Rack face (`front` / `rear`). */
export function faceLabel(value: string): string {
	return lookup(FACE_KEYS, value)
}

/** `<select>` options for the two rack faces. */
export function faceOptions(): { value: 'front' | 'rear'; label: string }[] {
	return [
		{ value: 'front', label: faceLabel('front') },
		{ value: 'rear', label: faceLabel('rear') },
	]
}

const CABLE_STATUS_KEYS: Record<string, MessageKey> = {
	connected: 'cableStatus.connected',
	planned: 'cableStatus.planned',
	decommissioned: 'cableStatus.decommissioned',
}

/** Cable status (`connected` / `planned` / `decommissioned`). */
export function cableStatusLabel(value: string): string {
	return lookup(CABLE_STATUS_KEYS, value)
}

const DEVICE_STATUS_KEYS: Record<string, MessageKey> = {
	active: 'deviceStatus.active',
	planned: 'deviceStatus.planned',
	staged: 'deviceStatus.staged',
	decommissioned: 'deviceStatus.decommissioned',
}

/** Device status (`active` / `planned` / `staged` / `decommissioned`). */
export function deviceStatusLabel(value: string): string {
	return lookup(DEVICE_STATUS_KEYS, value)
}

const ROLE_KEYS: Record<UserRole, MessageKey> = {
	admin: 'role.admin',
	editor: 'role.editor',
	viewer: 'role.viewer',
}

/** User role (`admin` / `editor` / `viewer`). */
export function roleLabel(value: string): string {
	return lookup(ROLE_KEYS, value)
}

/** `<select>` options for every user role. */
export function roleOptions(): { value: UserRole; label: string }[] {
	return (Object.keys(ROLE_KEYS) as UserRole[]).map((value) => ({
		value,
		label: roleLabel(value),
	}))
}

const LOCATION_TYPE_KEYS: Record<LocationType, MessageKey> = {
	floor: 'locationType.floor',
	room: 'locationType.room',
	other: 'locationType.other',
}

/** Location type (`floor` / `room` / `other`). */
export function locationTypeLabel(value: string): string {
	return lookup(LOCATION_TYPE_KEYS, value)
}

/** `<select>` options for built-in location types. */
export function locationTypeOptions(): { value: LocationType; label: string }[] {
	return LOCATION_TYPES.map((value) => ({ value, label: locationTypeLabel(value) }))
}
