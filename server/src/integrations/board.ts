/**
 * Link board: conex objects and external objects of one link level side by
 * side, with their link state and unambiguous match suggestions. Tenants are
 * listed in full (global users only; inactive and private customers only when linked);
 * devices per conex tenant, against the devices of the company linked to it.
 * Inactive devices are ignored by default (hidden unless toggled on, never
 * suggested); linked ones stay visible as linked.
 */
import { eq, inArray } from 'drizzle-orm'
import type {
	LinkBoard,
	LinkBoardExternal,
	LinkBoardLocal,
	IntegrationProvider as ProviderId,
} from 'shared/src/schemas'
import { getDb } from '../db/connection'
import { devices, tenant_groups, tenants } from '../schema'
import { type ExternalLinkRow, linkOf, listLinks } from './links'
import { group, matchDevices, normalizeName } from './match'
import { lastSyncedAt, localDevices } from './report'
import { readDevices, readTenant, readTenants } from './snapshot'

function joinDetail(...parts: (string | null)[]): string | null {
	const text = parts.filter((p) => p !== null && p !== '').join(' ')
	return text === '' ? null : text
}

function externalRow(
	base: Omit<LinkBoardExternal, 'link_id' | 'state' | 'entity_id' | 'entity_name'>,
	link: ExternalLinkRow | undefined,
	entityName: (id: number) => string | null,
): LinkBoardExternal {
	return {
		...base,
		link_id: link?.id ?? null,
		state: (link?.state as LinkBoardExternal['state']) ?? null,
		entity_id: link?.entity_id ?? null,
		entity_name:
			link?.entity_id !== null && link?.entity_id !== undefined
				? entityName(link.entity_id)
				: null,
	}
}

/** Suggests a name match when it is unique on both free sides. */
function uniqueNameMatches<L, E>(
	locals: L[],
	externals: E[],
	localName: (l: L) => string,
	externalName: (e: E) => string,
): Map<L, E> {
	const byLocal = group(locals, (l) => normalizeName(localName(l)))
	const byExternal = group(externals, (e) => normalizeName(externalName(e)))
	const out = new Map<L, E>()
	for (const [key, ls] of byLocal) {
		const es = byExternal.get(key)
		if (ls.length === 1 && es?.length === 1 && ls[0] !== undefined && es[0] !== undefined) {
			out.set(ls[0], es[0])
		}
	}
	return out
}

export async function tenantBoard(provider: ProviderId): Promise<LinkBoard> {
	const rows = await getDb()
		.select({ id: tenants.id, name: tenants.name, group: tenant_groups.name })
		.from(tenants)
		.leftJoin(tenant_groups, eq(tenants.tenant_group_id, tenant_groups.id))
		.orderBy(tenants.name)
	const tenantName = new Map(rows.map((r) => [r.id, r.name]))
	const allExternal = [...(await readTenants(provider)).values()].sort((a, b) =>
		a.name.localeCompare(b.name),
	)
	const externalById = new Map(allExternal.map((e) => [e.external_id, e]))
	const links = await listLinks(provider, 'tenant')
	const linkByExternal = new Map(links.map((l) => [l.external_id, l]))
	const linkByTenant = new Map<number, ExternalLinkRow>()
	for (const link of links) {
		if (link.state === 'linked' && link.entity_id !== null) {
			linkByTenant.set(link.entity_id, link)
		}
	}
	// Inactive and private customers are not offered for linking; ones
	// already linked stay listed so they can be unlinked.
	const externals = allExternal.filter(
		(e) =>
			(e.active && e.private !== true) ||
			linkByExternal.get(e.external_id)?.state === 'linked',
	)

	const suggestions = uniqueNameMatches(
		rows.filter((r) => !linkByTenant.has(r.id)),
		externals.filter((e) => !linkByExternal.has(e.external_id)),
		(r) => r.name,
		(e) => e.name,
	)

	const local: LinkBoardLocal[] = rows
		.map((row): LinkBoardLocal => {
			const link = linkByTenant.get(row.id)
			const suggested = suggestions.get(row)
			return {
				id: row.id,
				name: row.name,
				detail: row.group,
				serial: null,
				active: true,
				link_id: link?.id ?? null,
				external_id: link?.external_id ?? null,
				external_name: link ? (externalById.get(link.external_id)?.name ?? null) : null,
				ignored: false,
				suggestion: suggested ? { external_id: suggested.external_id, via: 'name' } : null,
			}
		})
		.sort(
			(a, b) =>
				(a.external_id === null ? 0 : 1) - (b.external_id === null ? 0 : 1) ||
				a.name.localeCompare(b.name),
		)
	const externalStateOrder = (state: LinkBoardExternal['state']): number =>
		state === 'ignored' ? 2 : state === 'linked' ? 1 : 0
	const external = externals
		.map((e) =>
			externalRow(
				{
					external_id: e.external_id,
					name: e.name,
					detail: e.display_id,
					serial: null,
					active: e.active,
				},
				linkByExternal.get(e.external_id),
				(id) => tenantName.get(id) ?? null,
			),
		)
		.sort(
			(a, b) =>
				externalStateOrder(a.state) - externalStateOrder(b.state) ||
				a.name.localeCompare(b.name),
		)
	return {
		provider,
		entity_type: 'tenant',
		synced_at: await lastSyncedAt(provider),
		external_tenant: null,
		local,
		external,
	}
}

export async function deviceBoard(provider: ProviderId, tenantId: number): Promise<LinkBoard> {
	const locals = (await localDevices(eq(devices.tenant_id, tenantId))).sort((a, b) =>
		a.name.localeCompare(b.name),
	)
	const tenantLink = await linkOf(provider, 'tenant', tenantId)
	const company = tenantLink ? await readTenant(provider, tenantLink.external_id) : null
	const externals = company
		? (await readDevices(provider, [company.external_id])).sort((a, b) =>
				a.name.localeCompare(b.name),
			)
		: []
	const links = await listLinks(provider, 'device')
	const linkByExternal = new Map(links.map((l) => [l.external_id, l]))
	const linkByDevice = new Map<number, ExternalLinkRow>()
	const ignoredByDevice = new Map<number, ExternalLinkRow>()
	for (const link of links) {
		if (link.state === 'linked' && link.entity_id !== null) {
			linkByDevice.set(link.entity_id, link)
		} else if (link.state === 'ignored' && link.entity_id !== null) {
			ignoredByDevice.set(link.entity_id, link)
		}
	}

	// Names of linked objects outside this board (other tenant / company).
	const localName = new Map(locals.map((d) => [d.id, d.name]))
	const foreignIds = externals
		.map((e) => linkByExternal.get(e.external_id)?.entity_id)
		.filter((id): id is number => id !== null && id !== undefined && !localName.has(id))
	if (foreignIds.length > 0) {
		for (const row of await getDb()
			.select({ id: devices.id, name: devices.name })
			.from(devices)
			.where(inArray(devices.id, foreignIds))) {
			localName.set(row.id, row.name)
		}
	}
	const externalById = new Map(externals.map((e) => [e.external_id, e]))
	const foreignExternal = locals
		.map((d) => linkByDevice.get(d.id)?.external_id)
		.filter((id): id is string => id !== undefined && !externalById.has(id))
	if (foreignExternal.length > 0) {
		for (const e of await readDevices(provider)) {
			if (foreignExternal.includes(e.external_id)) {
				externalById.set(e.external_id, e)
			}
		}
	}

	// Inactive devices are ignored by default: never suggested or auto-linked.
	const { auto, suggestions } = matchDevices(
		locals.filter(
			(d) => d.status === 'active' && !linkByDevice.has(d.id) && !ignoredByDevice.has(d.id),
		),
		externals.filter((e) => e.active && !linkByExternal.has(e.external_id)),
	)
	// Only offer a suggestion when the device has exactly one candidate.
	const candidates = new Map<number, typeof auto>()
	for (const pair of [...auto, ...suggestions]) {
		candidates.set(pair.device_id, [...(candidates.get(pair.device_id) ?? []), pair])
	}

	const local: LinkBoardLocal[] = locals
		.map((d): LinkBoardLocal => {
			const link = linkByDevice.get(d.id)
			const ignored = ignoredByDevice.get(d.id)
			// Inactive devices are ignored by default (no link row, so no
			// restore button); linking one still works via pick/drop.
			const defaultIgnored =
				d.status !== 'active' && link === undefined && ignored === undefined
			const pairs = candidates.get(d.id) ?? []
			const pair = pairs.length === 1 && !ignored && !defaultIgnored ? pairs[0] : undefined
			return {
				id: d.id,
				name: d.name,
				detail: joinDetail(d.manufacturer, d.model),
				serial: d.serial,
				active: d.status === 'active',
				link_id: link?.id ?? ignored?.id ?? null,
				external_id: link?.external_id ?? null,
				external_name: link ? (externalById.get(link.external_id)?.name ?? null) : null,
				ignored: ignored !== undefined || defaultIgnored,
				suggestion: pair ? { external_id: pair.external_id, via: pair.via } : null,
			}
		})
		.sort(
			(a, b) =>
				(a.ignored ? 2 : a.external_id === null ? 0 : 1) -
					(b.ignored ? 2 : b.external_id === null ? 0 : 1) ||
				a.name.localeCompare(b.name),
		)
	const externalStateOrder = (state: LinkBoardExternal['state']): number =>
		state === 'ignored' ? 2 : state === 'linked' ? 1 : 0
	const external = externals
		.map((e) => {
			const row = externalRow(
				{
					external_id: e.external_id,
					name: e.name,
					detail: joinDetail(e.manufacturer, e.model),
					serial: e.serial,
					active: e.active,
				},
				linkByExternal.get(e.external_id),
				(id) => localName.get(id) ?? null,
			)
			// Inactive devices are ignored by default (no link row, so no
			// restore button); linked ones stay visible as linked.
			return row.state === null && !e.active ? { ...row, state: 'ignored' as const } : row
		})
		.sort(
			(a, b) =>
				externalStateOrder(a.state) - externalStateOrder(b.state) ||
				a.name.localeCompare(b.name),
		)
	return {
		provider,
		entity_type: 'device',
		synced_at: await lastSyncedAt(provider),
		external_tenant: company,
		local,
		external,
	}
}
