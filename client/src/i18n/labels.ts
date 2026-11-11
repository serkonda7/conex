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
	CONTACT_SCOPES,
	type ContactScope,
	DEVICE_ROLE_ICONS,
	DEVICE_TYPE_EOL_FILTERS,
	type DeviceCompareField,
	type DeviceRoleIcon,
	type DeviceRoleKey,
	EMPLOYEE_SALUTATIONS,
	type EmployeeCompareField,
	type EmployeeSalutation,
	type FindingKind,
	HOLIDAY_REGIONS,
	type HolidayRegion,
	type IntegrationProvider,
	LOCATION_TYPES,
	type LocationType,
	NETBOX_INTERFACE_TYPES,
	PASS_THROUGH_PORT_TYPES,
	type Permission,
	PHONE_TYPES,
	type PhoneType,
	POE_TYPE_NAMES,
	POE_TYPE_SHORT_NAMES,
	type PoeMode,
	type PoeType,
	type PortKind,
	type PortSide,
	RACK_FORM_FACTORS,
	type SyncRunState,
	type TemplateSyncField,
} from 'shared/src/schemas'
import type { RackFormFactor } from '../api/templates'
import type { FormOption } from '../components/form'
import { RackFormFactorSchematic } from '../components/rack_form_factor'
import { deviceRoleIcon, locationTypeIcon, portKindIcon } from '../lib/icons'
import type { DurationUnit } from '../lib/service_level'
import { type MessageKey, type PluralKey, t, tp } from '.'

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

/** `<select>` options for the rack form factors, each previewing its schematic. */
export function formFactorOptions(): (FormOption & { value: RackFormFactor })[] {
	return RACK_FORM_FACTORS.map((value) => ({
		value,
		label: formFactorLabel(value),
		preview: () => RackFormFactorSchematic({ formFactor: value }),
	}))
}

/** "Yes" / "No" for a boolean (or 0/1 DB flag) cell. */
export function yesNo(value: boolean | number): string {
	return value ? t('common.yes') : t('common.no')
}

const DEVICE_TYPE_EOL_KEYS: Record<(typeof DEVICE_TYPE_EOL_FILTERS)[number], MessageKey> = {
	past: 'deviceType.eol.past',
	announced: 'deviceType.eol.announced',
	none: 'deviceType.eol.none',
}

/** Filter options for a device type's EOL state (past, announced, none). */
export function deviceTypeEolOptions(): { value: string; label: string }[] {
	return DEVICE_TYPE_EOL_FILTERS.map((value) => ({
		value,
		label: t(DEVICE_TYPE_EOL_KEYS[value]),
	}))
}

/** Yes / no filter options; both chosen is the same as none. */
export function yesNoOptions(): { value: 'true' | 'false'; label: string }[] {
	return [
		{ value: 'true', label: t('common.yes') },
		{ value: 'false', label: t('common.no') },
	]
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
	'power-iec-60320-c14': 'portKind.powerC14',
	'power-iec-60320-c20': 'portKind.powerC20',
	'power-iec-60320-c8': 'portKind.powerC8',
	'power-iec-60320-c6': 'portKind.powerC6',
	'power-ita-ef': 'portKind.schukoPlug',
	'power-dc-terminal': 'portKind.dcTerminal',
	'power-dc-barrel': 'portKind.dcBarrel',
	'power-usb-c': 'portKind.usbC',
	'power-outlet-iec-60320-c13': 'portKind.powerC13',
	'power-outlet-iec-60320-c19': 'portKind.powerC19',
	'power-outlet-iec-60320-c7': 'portKind.powerC7',
	'power-outlet-iec-60320-c5': 'portKind.powerC5',
	'power-outlet-ita-f': 'portKind.schukoSocket',
	'power-outlet-dc-terminal': 'portKind.dcTerminal',
	'power-outlet-usb-a': 'portKind.usbA',
	'power-outlet-usb-c': 'portKind.usbC',
	hdmi: 'portKind.hdmi',
	displayport: 'portKind.displayport',
	vga: 'portKind.vga',
	dvi: 'portKind.dvi',
}

/**
 * Interface kind (`ethernet`, `hdmi`, …). NetBox interface types show their
 * untranslated display name; unknown types fall back to the raw value.
 */
export function portKindLabel(value: string): string {
	if (Object.hasOwn(NETBOX_INTERFACE_TYPES, value)) {
		return NETBOX_INTERFACE_TYPES[value as keyof typeof NETBOX_INTERFACE_TYPES]
	}
	if (Object.hasOwn(PASS_THROUGH_PORT_TYPES, value)) {
		return PASS_THROUGH_PORT_TYPES[value as keyof typeof PASS_THROUGH_PORT_TYPES]
	}
	return lookup(PORT_KIND_KEYS, value)
}

/** Option label, with a trailing `(…)` in the detail column, which aligns and mutes it. */
function detailedLabel(label: string): Pick<FormOption, 'label' | 'detail'> {
	const paren = label.indexOf(' (')
	return paren === -1
		? { label }
		: { label: label.slice(0, paren), detail: label.slice(paren + 1) }
}

/** Option of a port kind. */
export function portKindOption(value: string): FormOption {
	return { value, icon: portKindIcon(value), ...detailedLabel(portKindLabel(value)) }
}

const POE_MODE_KEYS: Record<PoeMode, MessageKey> = {
	pse: 'poeMode.pse',
	pd: 'poeMode.pd',
}

/** PoE mode (`pse` / `pd`). */
export function poeModeLabel(value: string): string {
	return lookup(POE_MODE_KEYS, value)
}

/** PoE type (`type2-ieee802.3at`, …): an untranslated display name, like NetBox interface types. */
export function poeTypeLabel(value: PoeType): string {
	return POE_TYPE_NAMES[value]
}

/** PoE type without its standard, for table cells. */
export function poeTypeShortLabel(value: PoeType): string {
	return POE_TYPE_SHORT_NAMES[value]
}

/** Option of a PoE type. */
export function poeTypeOption(value: PoeType): FormOption {
	return { value, ...detailedLabel(poeTypeLabel(value)) }
}

const PORT_SIDE_KEYS: Record<PortSide, MessageKey> = {
	front: 'portSide.front',
	rear: 'portSide.rear',
}

/** Patch-panel port side (`front` / `rear`). */
export function portSideLabel(value: string): string {
	return lookup(PORT_SIDE_KEYS, value)
}

const TEMPLATE_SYNC_FIELD_KEYS: Record<TemplateSyncField, MessageKey> = {
	kind: 'device.templateSync.field.kind',
	positions: 'device.templateSync.field.positions',
	rear_port: 'device.templateSync.field.rear_port',
}

/** Port field a device type owns (`kind`, `positions`, …). */
export function templateSyncFieldLabel(value: string): string {
	return lookup(TEMPLATE_SYNC_FIELD_KEYS, value)
}

const DEVICE_TYPE_UPDATE_FIELD_KEYS: Record<string, MessageKey> = {
	manufacturer: 'deviceType.aiUpdate.manufacturer',
	model: 'common.model',
	u_height: 'common.heightU',
	is_full_depth: 'common.fullDepth',
	default_device_role: 'deviceType.defaultRole',
	part_number: 'deviceType.partNumber',
	spec_url: 'deviceType.specUrl',
	eol_date: 'deviceType.eolDate',
	description: 'common.description',
	comments: 'common.comments',
	kind: 'device.templateSync.field.kind',
	positions: 'device.templateSync.field.positions',
	rear_port: 'device.templateSync.field.rear_port',
	maximum_draw: 'deviceType.component.maximumDraw',
	poe_mode: 'deviceType.component.poeMode',
	poe_type: 'deviceType.component.poeType',
}

/** Device-type or port field changed by an AI update. */
export function deviceTypeUpdateFieldLabel(value: string): string {
	return lookup(DEVICE_TYPE_UPDATE_FIELD_KEYS, value)
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
	inactive: 'deviceStatus.inactive',
	planned: 'deviceStatus.planned',
	staged: 'deviceStatus.staged',
	decommissioned: 'deviceStatus.decommissioned',
}

/** Device status (`active` / `inactive` / `planned` / `staged` / `decommissioned`). */
export function deviceStatusLabel(value: string): string {
	return lookup(DEVICE_STATUS_KEYS, value)
}

const AUDIT_EVENT_KEYS: Record<AuditEvent, MessageKey> = {
	'login.success': 'auditEvent.loginSuccess',
	'login.failure': 'auditEvent.loginFailure',
	'password.change': 'auditEvent.passwordChange',
	'password.reset': 'auditEvent.passwordReset',
	'calendar_sync.config_update': 'auditEvent.calendarSyncConfigUpdate',
	'calendar_sync.mapping_update': 'auditEvent.calendarSyncMappingUpdate',
	'calendar_sync.mapping_delete': 'auditEvent.calendarSyncMappingDelete',
	'calendar_sync.run': 'auditEvent.calendarSyncRun',
}

/** Audit log event (`login.success`, `password.reset`, …). */
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
	tenant_group: 'entity.tenantGroup.one',
	tenant: 'entity.tenant.one',
	employee: 'entity.employee.one',
	site_group: 'entity.siteGroup.one',
	site: 'entity.site.one',
	location: 'entity.location.one',
	rack: 'entity.rack.one',
	shelf: 'entity.shelf.one',
	device: 'entity.device.one',
	virtual_machine: 'entity.virtualMachine.one',
	interface: 'changeObject.interface',
	panel_jack: 'entity.jack.one',
	cable: 'changeObject.cable',
	manufacturer: 'entity.manufacturer.one',
	device_type: 'entity.deviceType.one',
	rack_type: 'entity.rackType.one',
	interface_template: 'changeObject.interfaceTemplate',
	device_role: 'entity.deviceRole.one',
	attachment: 'changeObject.attachment',
	priority: 'entity.priority.one',
	service_level: 'entity.serviceLevel.one',
	managed_bundle: 'entity.managedBundle.one',
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
	'employees.tenants': 'permission.employeesTenants',
	'changelog.view': 'permission.changelogView',
	'audit_log.view': 'permission.auditLogView',
	'integrations.manage': 'permission.integrationsManage',
	'tickets.create': 'permission.ticketsCreate',
	'contacts.directory': 'permission.contactsDirectory',
}

/** Role permission (`view`, `users.manage`, …). */
export function permissionLabel(value: string): string {
	return lookup(PERMISSION_KEYS, value)
}

const LOCATION_TYPE_KEYS: Record<LocationType, MessageKey> = {
	building: 'locationType.building',
	floor: 'locationType.floor',
	room: 'locationType.room',
	desk: 'locationType.desk',
	other: 'locationType.other',
}

/** Location type (`building` / `floor` / `room` / `desk` / `other`). */
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
	display: 'deviceRoleIcon.display',
	camera: 'deviceRoleIcon.camera',
	ups: 'deviceRoleIcon.ups',
	'patch-panel': 'deviceRoleIcon.patchPanel',
	cloud: 'deviceRoleIcon.cloud',
	virtual: 'deviceRoleIcon.virtual',
}

const DEVICE_ROLE_KEY_KEYS: Record<DeviceRoleKey, MessageKey> = {
	pc: 'deviceRoleKey.pc',
	server: 'deviceRoleIcon.server',
	ap: 'deviceRoleIcon.accessPoint',
	firewall: 'deviceRoleIcon.firewall',
	'cloud-key': 'deviceRoleKey.cloudKey',
	switch: 'deviceRoleIcon.switch',
	'patch-panel': 'deviceRoleIcon.patchPanel',
	printer: 'deviceRoleIcon.printer',
	modem: 'deviceRoleKey.modem',
	telephony: 'deviceRoleKey.telephony',
	ups: 'deviceRoleIcon.ups',
}

/** Device role name: built-in roles (`key` set) are localized, custom ones keep their name. */
export function deviceRoleLabel(role: { name: string; key?: string | null }): string
export function deviceRoleLabel(
	role: { name: string; key?: string | null } | null | undefined,
): string | undefined
export function deviceRoleLabel(
	role: { name: string; key?: string | null } | null | undefined,
): string | undefined {
	if (!role) {
		return undefined
	}
	const key = role.key ? DEVICE_ROLE_KEY_KEYS[role.key as DeviceRoleKey] : undefined
	return key ? t(key) : role.name
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
	m365: 'provider.m365',
}

/** Integration provider name (`tanss` → TANSS). */
export function providerLabel(value: string): string {
	return lookup(PROVIDER_KEYS, value)
}

const EXTERNAL_TENANT_KEYS: Record<IntegrationProvider, PluralKey> = {
	tanss: 'externalTenant.tanss',
	m365: 'externalTenant.m365',
}

/**
 * What the provider calls the external side of a conex tenant, lowercase
 * where the language allows (TANSS: company, UniFi: site, M365: tenant).
 */
export function externalTenantLabel(provider: string, count = 1): string {
	const key = EXTERNAL_TENANT_KEYS[provider as IntegrationProvider]
	return key ? tp(key, count) : provider
}

/** {@link externalTenantLabel} for the start of a sentence or label. */
function externalTenantTitle(provider: string): string {
	const label = externalTenantLabel(provider)
	return label.charAt(0).toUpperCase() + label.slice(1)
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
	tenant_domain_unverified: 'finding.tenant_domain_unverified',
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
	employee_inactive_in_external: 'finding.employee_inactive_in_external',
	priority_tag_missing: 'finding.priority_tag_missing',
}

/** Consistency finding kind (`device_missing_in_conex`, …). */
/** Finding kind; tenant-level kinds name the provider's external tenant (company, site…). */
export function findingKindLabel(value: string, provider: string): string {
	const key = FINDING_KEYS[value as FindingKind]
	return key ? t(key, { tenant: externalTenantTitle(provider) }) : value
}

const COMPARE_FIELD_KEYS: Record<
	DeviceCompareField | EmployeeCompareField | 'customer_number' | 'domain' | 'tenant' | 'status',
	MessageKey
> = {
	name: 'common.name',
	customer_number: 'tenant.customerNumber',
	domain: 'compareField.domain',
	tenant: 'entity.tenant.one',
	status: 'common.status',
	serial: 'device.serial',
	asset_tag: 'compareField.asset_tag',
	manufacturer: 'entity.manufacturer.one',
	model: 'common.model',
	first_name: 'employee.firstName',
	last_name: 'employee.lastName',
	salutation: 'employee.salutation',
	title: 'employee.title',
	email: 'employee.email',
	phone: 'employee.phone',
	mobile: 'employee.mobile',
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

const CONTACT_SCOPE_KEYS: Record<ContactScope, MessageKey> = {
	work: 'contactScope.work',
	private: 'contactScope.private',
}

/** Work / private use of an employee mail address or phone number. */
export function contactScopeLabel(value: string): string {
	return lookup(CONTACT_SCOPE_KEYS, value)
}

/** `<select>` options for the contact scopes. */
export function contactScopeOptions(): { value: ContactScope; label: string }[] {
	return CONTACT_SCOPES.map((value) => ({ value, label: contactScopeLabel(value) }))
}

const PHONE_TYPE_KEYS: Record<PhoneType, MessageKey> = {
	phone: 'phoneType.phone',
	mobile: 'phoneType.mobile',
	extension: 'phoneType.extension',
}

/** Kind of an employee phone number (phone, mobile, extension). */
export function phoneTypeLabel(value: string): string {
	return lookup(PHONE_TYPE_KEYS, value)
}

/** `<select>` options for the phone number kinds. */
export function phoneTypeOptions(): { value: PhoneType; label: string }[] {
	return PHONE_TYPES.map((value) => ({ value, label: phoneTypeLabel(value) }))
}

/** A compared field value for display: enum values (salutation) are localized. */
export function compareValueLabel(field: string | null, value: string | null): string | null {
	return field === 'salutation' && value !== null ? employeeSalutationLabel(value) : value
}

const HOLIDAY_REGION_KEYS: Record<HolidayRegion, MessageKey> = {
	'DE-BW': 'holidayRegion.bw',
	'DE-BY': 'holidayRegion.by',
	'DE-BE': 'holidayRegion.be',
	'DE-BB': 'holidayRegion.bb',
	'DE-HB': 'holidayRegion.hb',
	'DE-HH': 'holidayRegion.hh',
	'DE-HE': 'holidayRegion.he',
	'DE-MV': 'holidayRegion.mv',
	'DE-NI': 'holidayRegion.ni',
	'DE-NW': 'holidayRegion.nw',
	'DE-RP': 'holidayRegion.rp',
	'DE-SL': 'holidayRegion.sl',
	'DE-SN': 'holidayRegion.sn',
	'DE-ST': 'holidayRegion.st',
	'DE-SH': 'holidayRegion.sh',
	'DE-TH': 'holidayRegion.th',
}

/** German federal state whose holidays a service level observes (`DE-BY`, …). */
export function holidayRegionLabel(value: string): string {
	return lookup(HOLIDAY_REGION_KEYS, value)
}

/** `<select>` options for the holiday regions, sorted by label. */
export function holidayRegionOptions(): (FormOption & { value: HolidayRegion })[] {
	return HOLIDAY_REGIONS.map((value) => ({ value, label: holidayRegionLabel(value) })).sort(
		(a, b) => a.label.localeCompare(b.label),
	)
}

/** Plural unit name of a target duration (`hours` → `Hours`). */
export function durationUnitLabel(unit: DurationUnit): string {
	return t(`serviceLevel.unit.${unit}`)
}
