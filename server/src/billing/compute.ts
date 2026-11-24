/**
 * Counts the lots of every contract from the current inventory: which
 * objects each (tenant, bundle, metric) bills, the resulting lot counts and
 * the findings that are not billed. Shared by the live view and snapshots;
 * see `BILLING_METRICS` for what each metric counts.
 */
import { Result } from 'better-result'
import { and, asc, eq, inArray, isNull, lte, notInArray } from 'drizzle-orm'
import { OTHER_PORT_KINDS } from 'shared/src/ports'
import {
	type BillingBundleJson,
	type BillingExceptionJson,
	type BillingItemType,
	type BillingMetric,
	type BillingMetricConfig,
	type ExternalEmployeeJson,
	STORAGE_STEP_GB_DEFAULT,
} from 'shared/src/schemas'
import { getDb } from '../db/connection'
import { errOf } from '../db/list'
import {
	billing_inputs,
	device_roles,
	devices,
	external_links,
	external_objects,
	integrations,
	interfaces,
	m365_tenants,
	managed_bundles,
	service_levels,
	tenant_bundles,
	tenants,
	virtual_machines,
} from '../schema'

/** Device and VM statuses that are billed. */
export const BILLABLE_STATUSES = ['active', 'staged']

/** Port kinds that are no switch ports (power, console, …, logical interfaces). */
const NON_SWITCH_PORT_KINDS: string[] = [...OTHER_PORT_KINDS, 'virtual', 'bridge', 'lag']

/** An M365 tenant not fetched successfully for this long is reported as stale. */
const M365_STALE_S = 7 * 24 * 60 * 60

/** One billed line: a metric of a contract. */
export interface CountRow {
	tenant_id: number
	tenant_name: string
	customer_number: string | null
	bundle_id: number
	bundle_name: string
	service_level_name: string
	metric: BillingMetric
	quantity: number
	lots: number
	carried: boolean
}

/** An object behind a count. */
export interface ItemRow {
	tenant_id: number
	bundle_id: number
	metric: BillingMetric
	item_type: BillingItemType
	item_id: string
	ref_id: number | null
	item_repr: string
	detail: string | null
}

export interface BillingData {
	bundles: BillingBundleJson[]
	counts: CountRow[]
	items: ItemRow[]
	exceptions: BillingExceptionJson[]
}

interface RoleNode {
	id: number
	parent_id: number | null
	managed_bundle_id: number | null
	key: string | null
	name: string
}

/** First value `pick` finds walking up from `roleId` (cycle-safe). */
function walkUp<T>(
	byId: Map<number, RoleNode>,
	roleId: number,
	pick: (role: RoleNode) => T | null,
): T | null {
	const seen = new Set<number>()
	let role = byId.get(roleId)
	while (role && !seen.has(role.id)) {
		const value = pick(role)
		if (value !== null) {
			return value
		}
		seen.add(role.id)
		role = role.parent_id === null ? undefined : byId.get(role.parent_id)
	}
	return null
}

/** Lots of one metric from its object count (or GB for `storage`). */
export function lotsOf(config: BillingMetricConfig, quantity: number): number {
	switch (config.metric) {
		case 'base':
			return 1
		case 'wlan':
			return quantity > 0 ? 1 : 0
		case 'storage':
			return Math.ceil(quantity / (config.step_gb ?? STORAGE_STEP_GB_DEFAULT))
		default:
			return quantity
	}
}

/** Key of the (tenant, bundle, metric) a count or item belongs to. */
export function lineKey(row: { tenant_id: number; bundle_id: number; metric: string }): string {
	return `${row.tenant_id}:${row.bundle_id}:${row.metric}`
}

/** Key of an item within its period. */
export function itemKey(row: ItemRow): string {
	return `${lineKey(row)}:${row.item_type}:${row.item_id}`
}

/**
 * Stored GB per contract for `period`: the period's own input, else the
 * latest earlier one (`carried`).
 */
export async function storageInputs(
	period: string,
): Promise<Map<string, { gb: number; carried: boolean }>> {
	const rows = await getDb()
		.select({
			tenant_id: billing_inputs.tenant_id,
			bundle_id: billing_inputs.bundle_id,
			period: billing_inputs.period,
			quantity: billing_inputs.quantity,
		})
		.from(billing_inputs)
		.where(and(eq(billing_inputs.metric, 'storage'), lte(billing_inputs.period, period)))
		.orderBy(asc(billing_inputs.period))
	const out = new Map<string, { gb: number; carried: boolean }>()
	// Ascending, so the latest period wins.
	for (const row of rows) {
		out.set(lineKey({ ...row, metric: 'storage' }), {
			gb: row.quantity,
			carried: row.period !== period,
		})
	}
	return out
}

/** Counts every contract against the current inventory. */
export async function computeBilling(
	period: string,
	nowS: number,
): Promise<Result<BillingData, Error>> {
	try {
		return Result.ok(await compute(period, nowS))
	} catch (err) {
		return Result.err(errOf(err))
	}
}

async function compute(period: string, nowS: number): Promise<BillingData> {
	const db = getDb()
	const roleRows: RoleNode[] = await db
		.select({
			id: device_roles.id,
			parent_id: device_roles.parent_id,
			managed_bundle_id: device_roles.managed_bundle_id,
			key: device_roles.key,
			name: device_roles.name,
		})
		.from(device_roles)
	const roles = new Map(roleRows.map((r) => [r.id, r]))
	const bundleOf = (roleId: number): number | null =>
		walkUp(roles, roleId, (r) => r.managed_bundle_id)
	const keyOf = (roleId: number): string | null => walkUp(roles, roleId, (r) => r.key)
	const roleName = (roleId: number): string | null => roles.get(roleId)?.name ?? null

	const bundleRows = await db
		.select({
			id: managed_bundles.id,
			name: managed_bundles.name,
			metrics: managed_bundles.billing_metrics,
		})
		.from(managed_bundles)
		.orderBy(asc(managed_bundles.name), asc(managed_bundles.id))
	const bundles = new Map(bundleRows.map((b) => [b.id, b]))

	const tenantRows = await db.select({ id: tenants.id, name: tenants.name }).from(tenants)
	const tenantName = new Map(tenantRows.map((t) => [t.id, t.name]))

	const contracts = await db
		.select({
			tenant_id: tenant_bundles.tenant_id,
			tenant_name: tenants.name,
			customer_number: tenants.customer_number,
			bundle_id: tenant_bundles.managed_bundle_id,
			service_level_name: service_levels.name,
		})
		.from(tenant_bundles)
		.innerJoin(tenants, eq(tenants.id, tenant_bundles.tenant_id))
		.innerJoin(service_levels, eq(service_levels.id, tenant_bundles.service_level_id))
		.orderBy(asc(tenants.name), asc(tenants.id))
	const contracted = new Set(contracts.map((c) => `${c.tenant_id}:${c.bundle_id}`))
	// Bundles billing a metric, per tenant.
	const billing = new Map<string, number[]>()
	for (const c of contracts) {
		for (const m of bundles.get(c.bundle_id)?.metrics ?? []) {
			const key = `${c.tenant_id}:${m.metric}`
			billing.set(key, [...(billing.get(key) ?? []), c.bundle_id])
		}
	}
	const bundlesBilling = (tenantId: number, metric: BillingMetric): number[] =>
		billing.get(`${tenantId}:${metric}`) ?? []
	const tenantsBilling = (metric: BillingMetric): number[] =>
		[...new Set(contracts.map((c) => c.tenant_id))].filter(
			(t) => bundlesBilling(t, metric).length > 0,
		)

	const items: ItemRow[] = []
	const exceptions: BillingExceptionJson[] = []
	const exception = (
		kind: BillingExceptionJson['kind'],
		fields: Partial<Omit<BillingExceptionJson, 'kind' | 'tenant_name' | 'bundle_name'>>,
	): void => {
		const tenant_id = fields.tenant_id ?? null
		const bundle_id = fields.bundle_id ?? null
		exceptions.push({
			kind,
			tenant_id,
			tenant_name: tenant_id === null ? null : (tenantName.get(tenant_id) ?? null),
			bundle_id,
			bundle_name: bundle_id === null ? null : (bundles.get(bundle_id)?.name ?? null),
			item_type: fields.item_type ?? null,
			ref_id: fields.ref_id ?? null,
			item_repr: fields.item_repr ?? null,
		})
	}

	// Devices and VMs: `objects` via their role's bundle, `backed_up` via the flag.
	const deviceRows = await db
		.select({
			id: devices.id,
			name: devices.name,
			tenant_id: devices.tenant_id,
			role_id: devices.device_role_id,
			backed_up: devices.backed_up,
		})
		.from(devices)
		.where(inArray(devices.status, BILLABLE_STATUSES))
	const vmRows = await db
		.select({
			id: virtual_machines.id,
			name: virtual_machines.name,
			tenant_id: virtual_machines.tenant_id,
			role_id: virtual_machines.device_role_id,
			host_device_id: virtual_machines.host_device_id,
			backed_up: virtual_machines.backed_up,
		})
		.from(virtual_machines)
		.where(inArray(virtual_machines.status, BILLABLE_STATUSES))
	const objects = [
		...deviceRows.map((d) => ({ ...d, type: 'device' as const, hostless: false })),
		...vmRows.map((v) => ({ ...v, type: 'vm' as const, hostless: v.host_device_id === null })),
	]
	for (const o of objects) {
		const bundleId = bundleOf(o.role_id)
		if (bundleId === null && o.backed_up !== 1) {
			continue
		}
		const ref = { item_type: o.type, ref_id: o.id, item_repr: o.name }
		const item = (tenantId: number, bundle: number, metric: BillingMetric): void => {
			items.push({
				tenant_id: tenantId,
				bundle_id: bundle,
				metric,
				item_type: o.type,
				item_id: String(o.id),
				ref_id: o.id,
				item_repr: o.name,
				detail: roleName(o.role_id),
			})
		}
		if (o.tenant_id === null) {
			exception('no_tenant', { ...ref, bundle_id: bundleId })
			continue
		}
		if (o.hostless) {
			exception('hostless_vm', { ...ref, tenant_id: o.tenant_id, bundle_id: bundleId })
			continue
		}
		if (bundleId !== null) {
			if (!contracted.has(`${o.tenant_id}:${bundleId}`)) {
				exception('not_contracted', { ...ref, tenant_id: o.tenant_id, bundle_id: bundleId })
			} else if (bundles.get(bundleId)?.metrics.some((m) => m.metric === 'objects')) {
				item(o.tenant_id, bundleId, 'objects')
			}
		}
		if (o.backed_up === 1) {
			const backup = bundlesBilling(o.tenant_id, 'backed_up')
			if (backup.length === 0) {
				exception('backup_not_contracted', { ...ref, tenant_id: o.tenant_id })
			}
			for (const b of backup) {
				item(o.tenant_id, b, 'backed_up')
			}
		}
	}

	// WLAN: access points of the tenant, whatever bundle they fall under.
	for (const d of deviceRows) {
		if (d.tenant_id !== null && keyOf(d.role_id) === 'ap') {
			for (const b of bundlesBilling(d.tenant_id, 'wlan')) {
				items.push({
					tenant_id: d.tenant_id,
					bundle_id: b,
					metric: 'wlan',
					item_type: 'device',
					item_id: String(d.id),
					ref_id: d.id,
					item_repr: d.name,
					detail: roleName(d.role_id),
				})
			}
		}
	}

	// Switch ports: connected network ports of the tenant's switches.
	const switchRoles = roleRows.filter((r) => keyOf(r.id) === 'switch').map((r) => r.id)
	const portTenants = tenantsBilling('switch_ports')
	if (switchRoles.length > 0 && portTenants.length > 0) {
		const ports = await db
			.select({
				id: interfaces.id,
				name: interfaces.name,
				device_id: devices.id,
				device_name: devices.name,
				tenant_id: devices.tenant_id,
			})
			.from(interfaces)
			.innerJoin(devices, eq(devices.id, interfaces.device_id))
			.where(
				and(
					inArray(devices.status, BILLABLE_STATUSES),
					inArray(devices.device_role_id, switchRoles),
					inArray(devices.tenant_id, portTenants),
					eq(interfaces.connected, 1),
					eq(interfaces.enabled, 1),
					isNull(interfaces.side),
					notInArray(interfaces.kind, NON_SWITCH_PORT_KINDS),
				),
			)
			.orderBy(asc(devices.name), asc(interfaces.id))
		for (const p of ports) {
			if (p.tenant_id === null) {
				continue
			}
			for (const b of bundlesBilling(p.tenant_id, 'switch_ports')) {
				items.push({
					tenant_id: p.tenant_id,
					bundle_id: b,
					metric: 'switch_ports',
					item_type: 'interface',
					item_id: String(p.id),
					ref_id: p.device_id,
					item_repr: `${p.device_name} · ${p.name}`,
					detail: null,
				})
			}
		}
	}

	await countM365Users(nowS, tenantsBilling('m365_users'), bundlesBilling, items, exception)

	// Counts: every metric of every contract, also when nothing was found.
	const perLine = new Map<string, number>()
	for (const i of items) {
		perLine.set(lineKey(i), (perLine.get(lineKey(i)) ?? 0) + 1)
	}
	const storage = await storageInputs(period)
	const counts: CountRow[] = []
	for (const c of contracts) {
		const bundle = bundles.get(c.bundle_id)
		for (const config of bundle?.metrics ?? []) {
			const line = { tenant_id: c.tenant_id, bundle_id: c.bundle_id, metric: config.metric }
			let quantity = perLine.get(lineKey(line)) ?? 0
			let carried = false
			if (config.metric === 'base') {
				quantity = 1
			} else if (config.metric === 'storage') {
				const input = storage.get(lineKey(line))
				if (!input) {
					exception('storage_missing', { tenant_id: c.tenant_id, bundle_id: c.bundle_id })
				}
				quantity = input?.gb ?? 0
				carried = input?.carried ?? false
			}
			counts.push({
				...c,
				bundle_name: bundle?.name ?? '',
				metric: config.metric,
				quantity,
				lots: lotsOf(config, quantity),
				carried,
			})
		}
	}

	const contractedBundles = new Set(contracts.map((c) => c.bundle_id))
	return {
		bundles: bundleRows
			.filter((b) => contractedBundles.has(b.id) && b.metrics.length > 0)
			.map((b) => ({ id: b.id, name: b.name, metrics: b.metrics })),
		counts,
		items,
		exceptions,
	}
}

/** M365 users: members of the linked Entra tenants as of the last sync. */
async function countM365Users(
	nowS: number,
	tenantIds: number[],
	bundlesBilling: (tenantId: number, metric: BillingMetric) => number[],
	items: ItemRow[],
	exception: (kind: BillingExceptionJson['kind'], fields: Partial<BillingExceptionJson>) => void,
): Promise<void> {
	if (tenantIds.length === 0) {
		return
	}
	const db = getDb()
	const links = await db
		.select({ tenant_id: external_links.entity_id, ms_tenant_id: external_links.external_id })
		.from(external_links)
		.where(
			and(
				eq(external_links.provider, 'm365'),
				eq(external_links.entity_type, 'tenant'),
				eq(external_links.state, 'linked'),
				inArray(external_links.entity_id, tenantIds),
			),
		)
	const msIds = [...new Set(links.map((l) => l.ms_tenant_id))]
	const fetched = new Map(
		(
			await db
				.select({ id: m365_tenants.ms_tenant_id, last_ok_at: m365_tenants.last_ok_at })
				.from(m365_tenants)
		).map((t) => [t.id, t.last_ok_at]),
	)
	const users =
		msIds.length === 0
			? []
			: await db
					.select({
						external_id: external_objects.external_id,
						ms_tenant_id: external_objects.external_tenant_id,
						data: external_objects.data,
					})
					.from(external_objects)
					.where(
						and(
							eq(external_objects.provider, 'm365'),
							eq(external_objects.object_type, 'employee'),
							inArray(external_objects.external_tenant_id, msIds),
						),
					)
	for (const tenantId of tenantIds) {
		const bundleIds = bundlesBilling(tenantId, 'm365_users')
		const linked = links.filter((l) => l.tenant_id === tenantId).map((l) => l.ms_tenant_id)
		if (linked.length === 0) {
			for (const b of bundleIds) {
				exception('m365_not_linked', { tenant_id: tenantId, bundle_id: b })
			}
			continue
		}
		const stale = linked.some((id) => {
			const ok = fetched.get(id) ?? null
			return ok === null || nowS - ok > M365_STALE_S
		})
		for (const b of bundleIds) {
			if (stale) {
				exception('m365_stale', { tenant_id: tenantId, bundle_id: b })
			}
			for (const u of users) {
				const data = u.data as ExternalEmployeeJson
				if (u.ms_tenant_id === null || !linked.includes(u.ms_tenant_id) || !data.active) {
					continue
				}
				items.push({
					tenant_id: tenantId,
					bundle_id: b,
					metric: 'm365_users',
					item_type: 'm365_user',
					item_id: u.external_id,
					ref_id: null,
					item_repr: data.name,
					detail: data.email,
				})
			}
		}
	}
	const [integration] = await db
		.select({ settings: integrations.settings })
		.from(integrations)
		.where(eq(integrations.provider, 'm365'))
	if (integration?.settings.licensed_only === false) {
		exception('m365_unlicensed', {})
	}
}
