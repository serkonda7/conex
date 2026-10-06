/**
 * Consistency report: compares conex tenants/devices/employees with the
 * stored snapshot through the link table. Computed on request (no findings
 * table).
 *
 * Only `active` conex devices/employees are reported as missing externally,
 * and only active external ones as missing in conex; linked ones in any
 * state are still compared.
 */
import { and, desc, eq, inArray, type SQL } from 'drizzle-orm'
import type {
	DeviceCompareField,
	DeviceIntegrationStatus,
	EmployeeCompareField,
	EmployeeIntegrationStatus,
	ExternalDeviceJson,
	ExternalEmployeeJson,
	FieldComparison,
	FindingKind,
	IntegrationFinding,
	IntegrationReport,
	IntegrationProvider as ProviderId,
	TenantIntegrationStatus,
} from 'shared/src/schemas'
import { DEVICE_COMPARE_FIELDS, EMPLOYEE_COMPARE_FIELDS } from 'shared/src/schemas'
import { getDb } from '../db/connection'
import { type TenantFilterParams, tenantConditions } from '../db/list'
import { device_types, devices, employees, manufacturers, sync_runs, tenants } from '../schema'
import { type ExternalLinkRow, linkJson, linkOf, listLinks } from './links'
import {
	matchDevices,
	matchEmployees,
	normalizeEmail,
	normalizeName,
	normalizeSerial,
	normalizeTag,
} from './match'
import {
	readDevice,
	readDevices,
	readEmployee,
	readEmployees,
	readTenant,
	readTenants,
} from './snapshot'
import type { ExternalDevice, ExternalEmployee } from './types'

export interface LocalDeviceRow {
	id: number
	name: string
	serial: string | null
	asset_tag: string | null
	status: string
	tenant_id: number | null
	manufacturer: string
	model: string
}

export async function localDevices(where: SQL | undefined): Promise<LocalDeviceRow[]> {
	return getDb()
		.select({
			id: devices.id,
			name: devices.name,
			serial: devices.serial,
			asset_tag: devices.asset_tag,
			status: devices.status,
			tenant_id: devices.tenant_id,
			manufacturer: manufacturers.name,
			model: device_types.model,
		})
		.from(devices)
		.innerJoin(device_types, eq(devices.device_type_id, device_types.id))
		.innerJoin(manufacturers, eq(device_types.manufacturer_id, manufacturers.id))
		.where(where)
}

const NORMALIZERS: Record<DeviceCompareField, (raw: string | null) => string | null> = {
	name: normalizeName,
	serial: normalizeSerial,
	asset_tag: normalizeTag,
	manufacturer: normalizeName,
	model: normalizeName,
}

function localValue(device: LocalDeviceRow, field: DeviceCompareField): string | null {
	return device[field]
}

function remoteValue(device: ExternalDevice, field: DeviceCompareField): string | null {
	return device[field]
}

/**
 * Field-by-field comparison. A value missing on either side is shown but not
 * counted as a mismatch (`equal: true`).
 */
export function compareFields(local: LocalDeviceRow, remote: ExternalDevice): FieldComparison[] {
	return DEVICE_COMPARE_FIELDS.map((field) => {
		const l = localValue(local, field)
		const r = remoteValue(remote, field)
		const normalize = NORMALIZERS[field]
		const nl = normalize(l)
		const nr = normalize(r)
		return { field, local: l, remote: r, equal: nl === null || nr === null || nl === nr }
	})
}

export interface LocalEmployeeRow {
	id: number
	name: string
	first_name: string | null
	last_name: string
	salutation: string | null
	title: string | null
	email: string | null
	phone: string | null
	mobile: string | null
	active: number
	tenant_id: number
}

export async function localEmployees(where: SQL | undefined): Promise<LocalEmployeeRow[]> {
	return getDb()
		.select({
			id: employees.id,
			name: employees.name,
			first_name: employees.first_name,
			last_name: employees.last_name,
			salutation: employees.salutation,
			title: employees.title,
			email: employees.email,
			phone: employees.phone,
			mobile: employees.mobile,
			active: employees.active,
			tenant_id: employees.tenant_id,
		})
		.from(employees)
		.where(where)
}

/** Phone numbers: digits and a leading `+` only; null when empty. */
function normalizePhone(raw: string | null): string | null {
	const key = (raw ?? '').replace(/(?!^\+)[^\d]/g, '')
	return key === '' || key === '+' ? null : key
}

const EMPLOYEE_NORMALIZERS: Record<EmployeeCompareField, (raw: string | null) => string | null> = {
	first_name: normalizeName,
	last_name: normalizeName,
	salutation: normalizeName,
	title: normalizeName,
	email: normalizeEmail,
	phone: normalizePhone,
	mobile: normalizePhone,
}

/** Like {@link compareFields}, for employees. */
export function compareEmployeeFields(
	local: LocalEmployeeRow,
	remote: ExternalEmployee,
): FieldComparison[] {
	return EMPLOYEE_COMPARE_FIELDS.map((field) => {
		const l = local[field]
		const r = remote[field]
		const normalize = EMPLOYEE_NORMALIZERS[field]
		const nl = normalize(l)
		const nr = normalize(r)
		return { field, local: l, remote: r, equal: nl === null || nr === null || nl === nr }
	})
}

function finding(kind: FindingKind, values: Partial<IntegrationFinding>): IntegrationFinding {
	return {
		kind,
		tenant_id: null,
		tenant_name: null,
		device_id: null,
		device_name: null,
		employee_id: null,
		employee_name: null,
		link_id: null,
		external_id: null,
		external_name: null,
		external_tenant_id: null,
		field: null,
		local: null,
		remote: null,
		...values,
	}
}

export async function lastSyncedAt(provider: ProviderId): Promise<number | null> {
	const row = (
		await getDb()
			.select({ finished_at: sync_runs.finished_at })
			.from(sync_runs)
			.where(and(eq(sync_runs.provider, provider), eq(sync_runs.state, 'ok')))
			.orderBy(desc(sync_runs.finished_at))
			.limit(1)
	)[0]
	return row?.finished_at ?? null
}

/**
 * Builds the report for the tenants selected by `filter`. `includeUnmapped`
 * adds external tenants that no conex tenant links to (global view only:
 * scoped users must not see other customers).
 */
export async function buildReport(
	provider: ProviderId,
	filter: TenantFilterParams,
	includeUnmapped: boolean,
): Promise<IntegrationReport> {
	const findings: IntegrationFinding[] = []
	const tenantRows = await getDb()
		.select({ id: tenants.id, name: tenants.name, customer_number: tenants.customer_number })
		.from(tenants)
		.where(and(...tenantConditions(tenants.id, filter)))
		.orderBy(tenants.name)
	const tenantName = new Map(tenantRows.map((t) => [t.id, t.name]))
	const externalTenants = await readTenants(provider)

	// Tenant level ----------------------------------------------------------
	const tenantLinks = await listLinks(provider, 'tenant')
	const linkByTenant = new Map<number, ExternalLinkRow>()
	const tenantRowByExternal = new Map<string, ExternalLinkRow>()
	for (const link of tenantLinks) {
		tenantRowByExternal.set(link.external_id, link)
		if (link.state === 'linked' && link.entity_id !== null) {
			linkByTenant.set(link.entity_id, link)
		}
	}
	// conex tenant → linked external tenant id, when the company still exists.
	const liveCompany = new Map<number, string>()
	for (const tenant of tenantRows) {
		const link = linkByTenant.get(tenant.id)
		const base = { tenant_id: tenant.id, tenant_name: tenant.name }
		if (!link) {
			findings.push(finding('tenant_unlinked', base))
			continue
		}
		const external = externalTenants.get(link.external_id)
		const linked = { ...base, link_id: link.id, external_id: link.external_id }
		if (!external) {
			findings.push(finding('tenant_stale', linked))
			continue
		}
		liveCompany.set(tenant.id, external.external_id)
		const withName = { ...linked, external_name: external.name }
		if (!external.active) {
			findings.push(finding('tenant_inactive', withName))
		}
		const localNumber = tenant.customer_number?.trim() || null
		const remoteNumber = external.display_id?.trim() || null
		// Customer numbers identify the company: a missing number on either
		// side counts as a difference (only both-empty is equal). Compared
		// case-insensitively, like asset tags.
		if ((localNumber?.toUpperCase() ?? null) !== (remoteNumber?.toUpperCase() ?? null)) {
			findings.push(
				finding('tenant_customer_number_mismatch', {
					...withName,
					field: 'customer_number',
					local: tenant.customer_number,
					remote: external.display_id,
				}),
			)
		}
	}
	if (includeUnmapped) {
		for (const external of externalTenants.values()) {
			if (
				external.active &&
				external.private !== true &&
				!tenantRowByExternal.has(external.external_id)
			) {
				findings.push(
					finding('tenant_missing_in_conex', {
						external_id: external.external_id,
						external_name: external.name,
						external_tenant_id: external.external_id,
					}),
				)
			}
		}
	}

	// Device level ----------------------------------------------------------
	const tenantIds = tenantRows.map((t) => t.id)
	const locals =
		tenantIds.length > 0 ? await localDevices(inArray(devices.tenant_id, tenantIds)) : []
	const deviceLinks = await listLinks(provider, 'device')
	const linkByDevice = new Map<number, ExternalLinkRow>()
	const ignoredLocalDevices = new Set<number>()
	const takenExternal = new Set<string>()
	for (const link of deviceLinks) {
		takenExternal.add(link.external_id)
		if (link.state === 'linked' && link.entity_id !== null) {
			linkByDevice.set(link.entity_id, link)
		} else if (link.state === 'ignored' && link.entity_id !== null) {
			ignoredLocalDevices.add(link.entity_id)
		}
	}
	const externalDevices = await readDevices(provider)
	const externalById = new Map(externalDevices.map((d) => [d.external_id, d]))

	const unlinkedByTenant = new Map<number, LocalDeviceRow[]>()
	for (const device of locals) {
		const tenantId = device.tenant_id
		const base = {
			tenant_id: tenantId,
			tenant_name: tenantId !== null ? (tenantName.get(tenantId) ?? null) : null,
			device_id: device.id,
			device_name: device.name,
		}
		const link = linkByDevice.get(device.id)
		if (!link) {
			if (
				tenantId !== null &&
				liveCompany.has(tenantId) &&
				!ignoredLocalDevices.has(device.id)
			) {
				const list = unlinkedByTenant.get(tenantId) ?? []
				list.push(device)
				unlinkedByTenant.set(tenantId, list)
			}
			continue
		}
		const external = externalById.get(link.external_id)
		const linked = { ...base, link_id: link.id, external_id: link.external_id }
		if (!external) {
			// Only stale when the device's company was fetched; otherwise the
			// snapshot simply does not cover it (tenant unlinked/stale).
			if (tenantId !== null && liveCompany.has(tenantId)) {
				findings.push(finding('device_stale', linked))
			}
			continue
		}
		const withExternal = {
			...linked,
			external_name: external.name,
			external_tenant_id: external.external_tenant_id,
		}
		const company = tenantId !== null ? liveCompany.get(tenantId) : undefined
		if (company !== external.external_tenant_id) {
			findings.push(
				finding('device_mismatch', {
					...withExternal,
					field: 'tenant',
					local: company ?? null,
					remote: external.external_tenant_id,
				}),
			)
		}
		if ((device.status === 'active') !== external.active) {
			findings.push(
				finding('device_mismatch', {
					...withExternal,
					field: 'status',
					local: device.status,
					remote: external.active ? 'active' : 'inactive',
				}),
			)
		}
		for (const cmp of compareFields(device, external)) {
			if (!cmp.equal) {
				findings.push(
					finding('device_mismatch', {
						...withExternal,
						field: cmp.field,
						local: cmp.local,
						remote: cmp.remote,
					}),
				)
			}
		}
	}

	for (const [tenantId, company] of liveCompany) {
		const tenantLocals = unlinkedByTenant.get(tenantId) ?? []
		const candidates = externalDevices.filter(
			(d) => d.external_tenant_id === company && !takenExternal.has(d.external_id),
		)
		const { auto, suggestions } = matchDevices(tenantLocals, candidates)
		const pairs = [...auto, ...suggestions]
		const suggestedLocal = new Set(pairs.map((p) => p.device_id))
		const suggestedExternal = new Set(pairs.map((p) => p.external_id))
		const base = { tenant_id: tenantId, tenant_name: tenantName.get(tenantId) ?? null }
		const localById = new Map(tenantLocals.map((d) => [d.id, d]))
		for (const pair of pairs) {
			const device = localById.get(pair.device_id)
			const external = externalById.get(pair.external_id)
			findings.push(
				finding('device_suggestion', {
					...base,
					device_id: pair.device_id,
					device_name: device?.name ?? null,
					external_id: pair.external_id,
					external_name: external?.name ?? null,
					external_tenant_id: company,
					field: pair.via === 'name' ? 'name' : pair.via,
				}),
			)
		}
		for (const device of tenantLocals) {
			if (device.status === 'active' && !suggestedLocal.has(device.id)) {
				findings.push(
					finding('device_missing_in_external', {
						...base,
						device_id: device.id,
						device_name: device.name,
						external_tenant_id: company,
					}),
				)
			}
		}
		for (const external of candidates) {
			if (external.active && !suggestedExternal.has(external.external_id)) {
				findings.push(
					finding('device_missing_in_conex', {
						...base,
						external_id: external.external_id,
						external_name: external.name,
						external_tenant_id: company,
					}),
				)
			}
		}
	}

	findings.push(...(await employeeFindings(provider, tenantIds, tenantName, liveCompany)))

	return { provider, synced_at: await lastSyncedAt(provider), findings }
}

/** Employee level of the report, for the tenants in `tenantIds`. */
async function employeeFindings(
	provider: ProviderId,
	tenantIds: number[],
	tenantName: Map<number, string>,
	liveCompany: Map<number, string>,
): Promise<IntegrationFinding[]> {
	const findings: IntegrationFinding[] = []
	const locals =
		tenantIds.length > 0 ? await localEmployees(inArray(employees.tenant_id, tenantIds)) : []
	const linkByEmployee = new Map<number, ExternalLinkRow>()
	const ignoredLocal = new Set<number>()
	const takenExternal = new Set<string>()
	for (const link of await listLinks(provider, 'employee')) {
		takenExternal.add(link.external_id)
		if (link.state === 'linked' && link.entity_id !== null) {
			linkByEmployee.set(link.entity_id, link)
		} else if (link.state === 'ignored' && link.entity_id !== null) {
			ignoredLocal.add(link.entity_id)
		}
	}
	const externals = await readEmployees(provider)
	// No snapshot yet (never synced, or dropped by a migration): every
	// linked employee would look stale until the next sync.
	if (externals.length === 0) {
		return findings
	}
	const externalById = new Map(externals.map((e) => [e.external_id, e]))

	const unlinkedByTenant = new Map<number, LocalEmployeeRow[]>()
	for (const employee of locals) {
		const tenantId = employee.tenant_id
		const company = liveCompany.get(tenantId)
		const base = {
			tenant_id: tenantId,
			tenant_name: tenantName.get(tenantId) ?? null,
			employee_id: employee.id,
			employee_name: employee.name,
		}
		const link = linkByEmployee.get(employee.id)
		if (!link) {
			if (company !== undefined && !ignoredLocal.has(employee.id)) {
				const list = unlinkedByTenant.get(tenantId) ?? []
				list.push(employee)
				unlinkedByTenant.set(tenantId, list)
			}
			continue
		}
		const linked = { ...base, link_id: link.id, external_id: link.external_id }
		const external = externalById.get(link.external_id)
		if (!external) {
			// Employees are fetched in full, so a missing one is gone.
			findings.push(finding('employee_stale', linked))
			continue
		}
		const withExternal = {
			...linked,
			external_name: external.name,
			external_tenant_id: external.external_tenant_id,
		}
		if (company === undefined || !external.external_tenant_ids.includes(company)) {
			findings.push(
				finding('employee_mismatch', {
					...withExternal,
					field: 'tenant',
					local: company ?? null,
					remote: external.external_tenant_id,
				}),
			)
		}
		if ((employee.active === 1) !== external.active) {
			findings.push(
				finding('employee_mismatch', {
					...withExternal,
					field: 'status',
					local: employee.active === 1 ? 'active' : 'inactive',
					remote: external.active ? 'active' : 'inactive',
				}),
			)
		}
		for (const cmp of compareEmployeeFields(employee, external)) {
			if (!cmp.equal) {
				findings.push(
					finding('employee_mismatch', {
						...withExternal,
						field: cmp.field,
						local: cmp.local,
						remote: cmp.remote,
					}),
				)
			}
		}
	}

	for (const [tenantId, company] of liveCompany) {
		const tenantLocals = unlinkedByTenant.get(tenantId) ?? []
		const candidates = externals.filter(
			(e) => e.external_tenant_ids.includes(company) && !takenExternal.has(e.external_id),
		)
		const { auto, suggestions } = matchEmployees(tenantLocals, candidates)
		const pairs = [...auto, ...suggestions]
		const suggestedLocal = new Set(pairs.map((p) => p.employee_id))
		const suggestedExternal = new Set(pairs.map((p) => p.external_id))
		const base = { tenant_id: tenantId, tenant_name: tenantName.get(tenantId) ?? null }
		const localById = new Map(tenantLocals.map((e) => [e.id, e]))
		for (const pair of pairs) {
			findings.push(
				finding('employee_suggestion', {
					...base,
					employee_id: pair.employee_id,
					employee_name: localById.get(pair.employee_id)?.name ?? null,
					external_id: pair.external_id,
					external_name: externalById.get(pair.external_id)?.name ?? null,
					external_tenant_id: company,
					field: pair.via,
				}),
			)
		}
		for (const employee of tenantLocals) {
			if (employee.active === 1 && !suggestedLocal.has(employee.id)) {
				findings.push(
					finding('employee_missing_in_external', {
						...base,
						employee_id: employee.id,
						employee_name: employee.name,
						external_tenant_id: company,
					}),
				)
			}
		}
		for (const external of candidates) {
			if (external.active && !suggestedExternal.has(external.external_id)) {
				findings.push(
					finding('employee_missing_in_conex', {
						...base,
						external_id: external.external_id,
						external_name: external.name,
						external_tenant_id: company,
					}),
				)
			}
		}
	}
	return findings
}

/** Tenant detail card: link, linked company and finding counts. */
export async function tenantStatus(
	provider: ProviderId,
	tenantId: number,
): Promise<TenantIntegrationStatus> {
	const link = await linkOf(provider, 'tenant', tenantId)
	const external = link ? await readTenant(provider, link.external_id) : null
	const report = await buildReport(provider, { tenant: tenantId }, false)
	const finding_counts: Partial<Record<FindingKind, number>> = {}
	for (const f of report.findings) {
		finding_counts[f.kind] = (finding_counts[f.kind] ?? 0) + 1
	}
	return { link: link ? linkJson(link) : null, external, finding_counts }
}

/** Device detail card: link, field comparison and link candidates. */
export async function deviceStatus(
	provider: ProviderId,
	deviceId: number,
	tenantId: number | null,
): Promise<DeviceIntegrationStatus> {
	const [local] = await localDevices(eq(devices.id, deviceId))
	const link = await linkOf(provider, 'device', deviceId)
	const tenantLink = tenantId !== null ? await linkOf(provider, 'tenant', tenantId) : null
	const external_tenant = tenantLink ? await readTenant(provider, tenantLink.external_id) : null
	const external = link ? await readDevice(provider, link.external_id) : null
	let candidates: ExternalDeviceJson[] = []
	if (external_tenant) {
		const taken = new Set((await listLinks(provider, 'device')).map((l) => l.external_id))
		candidates = (await readDevices(provider, [external_tenant.external_id]))
			.filter((d) => !taken.has(d.external_id))
			.sort((a, b) => a.name.localeCompare(b.name))
	}
	return {
		link: link ? linkJson(link) : null,
		external,
		fields: local && external ? compareFields(local, external) : [],
		external_tenant,
		candidates,
	}
}

/** Employee detail card: link, field comparison and link candidates. */
export async function employeeStatus(
	provider: ProviderId,
	employeeId: number,
	tenantId: number,
): Promise<EmployeeIntegrationStatus> {
	const [local] = await localEmployees(eq(employees.id, employeeId))
	const link = await linkOf(provider, 'employee', employeeId)
	const tenantLink = await linkOf(provider, 'tenant', tenantId)
	const external_tenant = tenantLink ? await readTenant(provider, tenantLink.external_id) : null
	const external = link ? await readEmployee(provider, link.external_id) : null
	let candidates: ExternalEmployeeJson[] = []
	if (external_tenant) {
		const taken = new Set((await listLinks(provider, 'employee')).map((l) => l.external_id))
		candidates = (await readEmployees(provider, external_tenant.external_id))
			.filter((e) => !taken.has(e.external_id))
			.sort((a, b) => a.name.localeCompare(b.name))
	}
	return {
		link: link ? linkJson(link) : null,
		external,
		fields: local && external ? compareEmployeeFields(local, external) : [],
		external_tenant,
		candidates,
	}
}
