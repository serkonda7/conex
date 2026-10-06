/**
 * Localized display labels for API enum values. The raw values stay the
 * wire format; only what the user sees goes through the dictionaries.
 * Row types carry most enums as plain strings, so every label helper
 * accepts any string and falls back to the raw value for unknown ones.
 */
import {
	AUDIT_EVENTS,
	type AuditEvent,
	CHANGE_ACTIONS,
	CHANGE_OBJECT_TYPES,
	type ChangeAction,
	type ChangeObjectType,
	DEVICE_ROLE_ICONS,
	type DeviceCompareField,
	type DeviceRoleIcon,
	EMPLOYEE_SALUTATIONS,
	type EmployeeCompareField,
	type EmployeeSalutation,
	type FindingKind,
	type IntegrationProvider,
	LOCATION_TYPES,
	type LocationType,
	type Permission,
	PORT_KINDS,
	type PortKind,
	type SyncRunState,
} from 'shared/src/schemas'
import type { RackFormFactor } from '../api/templates'
import type { FormOption } from '../components/form'
import { deviceRoleIcon, locationTypeIcon } from '../lib/icons'
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

const PORT_KIND_KEYS: Record<PortKind, MessageKey> = {
	ethernet: 'portKind.ethernet',
	port: 'portKind.port',
	'rj-45': 'portKind.rj45',
	'de-9': 'portKind.de9',
	'db-25': 'portKind.db25',
	'rj-11': 'portKind.rj11',
	'rj-12': 'portKind.rj12',
	'mini-din-8': 'portKind.miniDin8',
	'usb-a': 'portKind.usbA',
	'usb-b': 'portKind.usbB',
	'usb-c': 'portKind.usbC',
	'usb-mini-a': 'portKind.usbMiniA',
	'usb-mini-b': 'portKind.usbMiniB',
	'usb-micro-a': 'portKind.usbMicroA',
	'usb-micro-b': 'portKind.usbMicroB',
	'usb-micro-ab': 'portKind.usbMicroAb',
	power: 'portKind.power',
	'power-outlet': 'portKind.powerOutlet',
	hdmi: 'portKind.hdmi',
	displayport: 'portKind.displayport',
	vga: 'portKind.vga',
	dvi: 'portKind.dvi',
}

/** Interface kind (`ethernet`, `hdmi`, …); NetBox types fall back to the raw value. */
export function portKindLabel(value: string): string {
	return lookup(PORT_KIND_KEYS, value)
}

/** `<select>` options for the built-in interface kinds. */
export function portKindOptions(): { value: PortKind; label: string }[] {
	return PORT_KINDS.map((value) => ({ value, label: portKindLabel(value) }))
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

const CHANGE_ACTION_KEYS: Record<ChangeAction, MessageKey> = {
	create: 'changeAction.create',
	update: 'changeAction.update',
	delete: 'changeAction.delete',
}

/** Changelog action (`create` / `update` / `delete`). */
export function changeActionLabel(value: string): string {
	return lookup(CHANGE_ACTION_KEYS, value)
}

/** `<select>` options for every changelog action. */
export function changeActionOptions(): { value: ChangeAction; label: string }[] {
	return CHANGE_ACTIONS.map((value) => ({ value, label: changeActionLabel(value) }))
}

const CHANGE_OBJECT_KEYS: Record<ChangeObjectType, MessageKey> = {
	tenant_group: 'changeObject.tenantGroup',
	tenant: 'changeObject.tenant',
	employee: 'changeObject.employee',
	site_group: 'changeObject.siteGroup',
	site: 'changeObject.site',
	location: 'changeObject.location',
	rack: 'changeObject.rack',
	shelf: 'changeObject.shelf',
	device: 'changeObject.device',
	interface: 'changeObject.interface',
	cable: 'changeObject.cable',
	manufacturer: 'changeObject.manufacturer',
	device_type: 'changeObject.deviceType',
	rack_type: 'changeObject.rackType',
	interface_template: 'changeObject.interfaceTemplate',
	device_role: 'changeObject.deviceRole',
}

/** Changelog object type (`device`, `rack_type`, …). */
export function changeObjectLabel(value: string): string {
	return lookup(CHANGE_OBJECT_KEYS, value)
}

/** `<select>` options for every changelog object type, sorted by label. */
export function changeObjectOptions(): { value: ChangeObjectType; label: string }[] {
	return CHANGE_OBJECT_TYPES.map((value) => ({ value, label: changeObjectLabel(value) })).sort(
		(a, b) => a.label.localeCompare(b.label),
	)
}

const PERMISSION_KEYS: Record<Permission, MessageKey> = {
	view: 'permission.view',
	edit: 'permission.edit',
	delete: 'permission.delete',
	'users.manage': 'permission.usersManage',
	'changelog.view': 'permission.changelogView',
	'audit_log.view': 'permission.auditLogView',
	'integrations.manage': 'permission.integrationsManage',
	'tickets.create': 'permission.ticketsCreate',
}

/** Role permission (`view`, `users.manage`, …). */
export function permissionLabel(value: string): string {
	return lookup(PERMISSION_KEYS, value)
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
export function locationTypeOptions(): (FormOption & { value: LocationType })[] {
	return LOCATION_TYPES.map((value) => ({
		value,
		label: locationTypeLabel(value),
		icon: locationTypeIcon(value),
	}))
}

const DEVICE_ROLE_ICON_KEYS: Record<DeviceRoleIcon, MessageKey> = {
	desktop: 'deviceRoleIcon.desktop',
	laptop: 'deviceRoleIcon.laptop',
	server: 'deviceRoleIcon.server',
	switch: 'deviceRoleIcon.switch',
	router: 'deviceRoleIcon.router',
	firewall: 'deviceRoleIcon.firewall',
	'access-point': 'deviceRoleIcon.accessPoint',
	storage: 'deviceRoleIcon.storage',
	printer: 'deviceRoleIcon.printer',
	phone: 'deviceRoleIcon.phone',
	mobile: 'deviceRoleIcon.mobile',
	tablet: 'deviceRoleIcon.tablet',
	display: 'deviceRoleIcon.display',
	camera: 'deviceRoleIcon.camera',
	ups: 'deviceRoleIcon.ups',
	'patch-panel': 'deviceRoleIcon.patchPanel',
	cloud: 'deviceRoleIcon.cloud',
	virtual: 'deviceRoleIcon.virtual',
}

/** Device role icon (`server`, `access-point`, …). */
export function deviceRoleIconLabel(value: string): string {
	return lookup(DEVICE_ROLE_ICON_KEYS, value)
}

/** `<select>` options for every device role icon. */
export function deviceRoleIconOptions(): (FormOption & { value: DeviceRoleIcon })[] {
	return DEVICE_ROLE_ICONS.map((value) => ({
		value,
		label: deviceRoleIconLabel(value),
		icon: deviceRoleIcon(value),
	}))
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
	tenant_customer_number_mismatch: 'finding.tenant_customer_number_mismatch',
	device_missing_in_conex: 'finding.device_missing_in_conex',
	device_missing_in_external: 'finding.device_missing_in_external',
	device_suggestion: 'finding.device_suggestion',
	device_stale: 'finding.device_stale',
	device_mismatch: 'finding.device_mismatch',
	employee_missing_in_conex: 'finding.employee_missing_in_conex',
	employee_missing_in_external: 'finding.employee_missing_in_external',
	employee_suggestion: 'finding.employee_suggestion',
	employee_stale: 'finding.employee_stale',
	employee_mismatch: 'finding.employee_mismatch',
}

/** Consistency finding kind (`device_missing_in_conex`, …). */
export function findingKindLabel(value: string): string {
	return lookup(FINDING_KEYS, value)
}

const COMPARE_FIELD_KEYS: Record<
	DeviceCompareField | EmployeeCompareField | 'customer_number' | 'tenant' | 'status',
	MessageKey
> = {
	name: 'compareField.name',
	customer_number: 'compareField.customer_number',
	tenant: 'compareField.tenant',
	status: 'compareField.status',
	serial: 'compareField.serial',
	asset_tag: 'compareField.asset_tag',
	manufacturer: 'compareField.manufacturer',
	model: 'compareField.model',
	first_name: 'compareField.first_name',
	last_name: 'compareField.last_name',
	salutation: 'compareField.salutation',
	title: 'compareField.title',
	email: 'compareField.email',
	phone: 'compareField.phone',
	mobile: 'compareField.mobile',
}

/** Compared device or employee field (`serial`, `email`, …). */
export function compareFieldLabel(value: string): string {
	return lookup(COMPARE_FIELD_KEYS, value)
}

const EMPLOYEE_SALUTATION_KEYS: Record<EmployeeSalutation, MessageKey> = {
	mr: 'employeeSalutation.mr',
	ms: 'employeeSalutation.ms',
}

/** Employee salutation (`mr` → Herr, `ms` → Frau). */
export function employeeSalutationLabel(value: string): string {
	return lookup(EMPLOYEE_SALUTATION_KEYS, value)
}

/** `<select>` options for the employee salutations. */
export function employeeSalutationOptions(): { value: EmployeeSalutation; label: string }[] {
	return EMPLOYEE_SALUTATIONS.map((value) => ({ value, label: employeeSalutationLabel(value) }))
}

/** A compared field value for display: enum values (salutation) are localized. */
export function compareValueLabel(field: string | null, value: string | null): string | null {
	return field === 'salutation' && value !== null ? employeeSalutationLabel(value) : value
}
