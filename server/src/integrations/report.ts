/**
 * Consistency report: compares conex tenants/devices with the stored
 * snapshot through the link table. Computed on request (no findings table).
 *
 * Only `active` conex devices are reported as missing externally, and only
 * active external devices as missing in conex; linked devices in any state
 * are still compared.
 */
import { and, desc, eq, inArray, type SQL } from 'drizzle-orm'
import type {
	DeviceCompareField,
	DeviceIntegrationStatus,
	ExternalDeviceJson,
	FieldComparison,
	FindingKind,
	IntegrationFinding,
	IntegrationReport,
	IntegrationProvider as ProviderId,
	TenantIntegrationStatus,
} from 'shared/src/schemas'
import { DEVICE_COMPARE_FIELDS } from 'shared/src/schemas'
import { getDb } from '../db/connection'
import type { TenantFilterParams } from '../db/list'
import { device_types, devices, manufacturers, sync_runs, tenants } from '../schema'
import { type ExternalLinkRow, linkJson, linkOf, listLinks } from './links'
import { matchDevices, normalizeName, normalizeSerial, normalizeTag } from './match'
import { readDevice, readDevices, readTenant, readTenants } from './snapshot'
import type { ExternalDevice } from './types'

interface LocalDeviceRow {
	id: number
	name: string
	serial: string | null
	asset_tag: string | null
	status: string
	tenant_id: number | null
	manufacturer: string
	model: string
}

async function localDevices(where: SQL | undefined): Promise<LocalDeviceRow[]> {
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

function finding(kind: FindingKind, values: Partial<IntegrationFinding>): IntegrationFinding {
	return {
		kind,
		tenant_id: null,
		tenant_name: null,
		device_id: null,
		device_name: null,
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

function tenantConditionsById(params: TenantFilterParams): SQL[] {
	const conditions: SQL[] = []
	if (params.tenant !== undefined) {
		conditions.push(eq(tenants.id, params.tenant))
	}
	if (params.tenantIds !== undefined) {
		conditions.push(
			params.tenantIds.length > 0
				? inArray(tenants.id, params.tenantIds)
				: eq(tenants.id, -1),
		)
	}
	if (params.scopeTenantId !== undefined) {
		conditions.push(eq(tenants.id, params.scopeTenantId))
	}
	return conditions
}

async function lastSyncedAt(provider: ProviderId): Promise<number | null> {
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
	const conditions = tenantConditionsById(filter)
	const tenantRows = await getDb()
		.select({ id: tenants.id, name: tenants.name })
		.from(tenants)
		.where(conditions.length > 0 ? and(...conditions) : undefined)
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
		if (normalizeName(external.name) !== normalizeName(tenant.name)) {
			findings.push(
				finding('tenant_name_mismatch', {
					...withName,
					field: 'name',
					local: tenant.name,
					remote: external.name,
				}),
			)
		}
	}
	if (includeUnmapped) {
		for (const external of externalTenants.values()) {
			if (external.active && !tenantRowByExternal.has(external.external_id)) {
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
	const takenExternal = new Set<string>()
	for (const link of deviceLinks) {
		takenExternal.add(link.external_id)
		if (link.state === 'linked' && link.entity_id !== null) {
			linkByDevice.set(link.entity_id, link)
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
			if (tenantId !== null && liveCompany.has(tenantId)) {
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
			findings.push(finding('device_tenant_mismatch', withExternal))
		}
		if ((device.status === 'active') !== external.active) {
			findings.push(
				finding('device_status_mismatch', {
					...withExternal,
					local: device.status,
					remote: external.active ? 'active' : 'inactive',
				}),
			)
		}
		for (const cmp of compareFields(device, external)) {
			if (!cmp.equal) {
				findings.push(
					finding('device_field_mismatch', {
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

	return { provider, synced_at: await lastSyncedAt(provider), findings }
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
