/**
 * Localized display labels for API enum values. The raw values stay the
 * wire format; only what the user sees goes through the dictionaries.
 * Row types carry most enums as plain strings, so every label helper
 * accepts any string and falls back to the raw value for unknown ones.
 */
import {
	AUDIT_EVENTS,
	type AuditEvent,
	type DeviceCompareField,
	type FindingKind,
	type IntegrationProvider,
	LOCATION_TYPES,
	type LocationType,
	type SyncRunState,
} from 'shared/src/schemas'
import type { RackFormFactor } from '../api/templates'
import type { UserRole } from '../api/users'
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

const AUDIT_EVENT_KEYS: Record<AuditEvent, MessageKey> = {
	'login.success': 'auditEvent.loginSuccess',
	'login.failure': 'auditEvent.loginFailure',
}

/** Audit log event (`login.success` / `login.failure`). */
export function auditEventLabel(value: string): string {
	return lookup(AUDIT_EVENT_KEYS, value)
}

/** `<select>` options for every audit log event. */
export function auditEventOptions(): { value: AuditEvent; label: string }[] {
	return AUDIT_EVENTS.map((value) => ({ value, label: auditEventLabel(value) }))
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

const PROVIDER_KEYS: Record<IntegrationProvider, MessageKey> = {
	tanss: 'provider.tanss',
}

/** Integration provider name (`tanss` → TANSS). */
export function providerLabel(value: string): string {
	return lookup(PROVIDER_KEYS, value)
}

const SYNC_STATE_KEYS: Record<SyncRunState, MessageKey> = {
	running: 'syncState.running',
	ok: 'syncState.ok',
	error: 'syncState.error',
}

/** Sync run state (`running` / `ok` / `error`). */
export function syncStateLabel(value: string): string {
	return lookup(SYNC_STATE_KEYS, value)
}

const FINDING_KEYS: Record<FindingKind, MessageKey> = {
	tenant_unlinked: 'finding.tenant_unlinked',
	tenant_missing_in_conex: 'finding.tenant_missing_in_conex',
	tenant_stale: 'finding.tenant_stale',
	tenant_inactive: 'finding.tenant_inactive',
	tenant_name_mismatch: 'finding.tenant_name_mismatch',
	device_missing_in_conex: 'finding.device_missing_in_conex',
	device_missing_in_external: 'finding.device_missing_in_external',
	device_suggestion: 'finding.device_suggestion',
	device_stale: 'finding.device_stale',
	device_tenant_mismatch: 'finding.device_tenant_mismatch',
	device_field_mismatch: 'finding.device_field_mismatch',
	device_status_mismatch: 'finding.device_status_mismatch',
}

/** Consistency finding kind (`device_missing_in_conex`, …). */
export function findingKindLabel(value: string): string {
	return lookup(FINDING_KEYS, value)
}

const COMPARE_FIELD_KEYS: Record<DeviceCompareField, MessageKey> = {
	name: 'compareField.name',
	serial: 'compareField.serial',
	asset_tag: 'compareField.asset_tag',
	manufacturer: 'compareField.manufacturer',
	model: 'compareField.model',
}

/** Compared device field (`serial`, `asset_tag`, …). */
export function compareFieldLabel(value: string): string {
	return lookup(COMPARE_FIELD_KEYS, value)
}
