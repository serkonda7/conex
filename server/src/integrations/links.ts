/**
 * `external_links`: which conex tenant/site/device/employee is which external object, plus
 * external objects marked as intentionally absent (`ignored`). An external
 * object has at most one row per entity type, and a conex entity at most one
 * link per provider; linking or ignoring again replaces those rows. External
 * tenants link to tenants, or to sites for providers with `link_level: 'site'`
 * (UniFi consoles). Route handlers do the RBAC/scope checks.
 */
import { Result } from 'better-result'
import { and, asc, eq, inArray, or } from 'drizzle-orm'
import type {
	ExternalLinkJson,
	LinkEntityType,
	IntegrationProvider as ProviderId,
} from 'shared/src/schemas'
import { getDb, withTransaction } from '../db/connection'
import { NotFoundError } from '../db/errors'
import { tryWrite } from '../db/list'
import { devices, external_links, sites } from '../schema'
import { nowSeconds } from '../util/time'
import { providerDefinition } from './registry'

export type ExternalLinkRow = typeof external_links.$inferSelect

export function linkJson(row: ExternalLinkRow): ExternalLinkJson {
	return {
		id: row.id,
		provider: row.provider as ProviderId,
		entity_type: row.entity_type as LinkEntityType,
		entity_id: row.entity_id,
		external_id: row.external_id,
		external_tenant_id: row.external_tenant_id,
		state: row.state as ExternalLinkJson['state'],
		method: row.method as ExternalLinkJson['method'],
		created_by: row.created_by,
		created_at: row.created_at,
	}
}

export async function listLinks(
	provider: ProviderId,
	entityType: LinkEntityType,
): Promise<ExternalLinkRow[]> {
	return getDb()
		.select()
		.from(external_links)
		.where(
			and(eq(external_links.provider, provider), eq(external_links.entity_type, entityType)),
		)
}

export async function getLink(
	provider: ProviderId,
	id: number,
): Promise<Result<ExternalLinkRow, Error>> {
	const row = (
		await getDb()
			.select()
			.from(external_links)
			.where(and(eq(external_links.provider, provider), eq(external_links.id, id)))
			.limit(1)
	)[0]
	return row ? Result.ok(row) : Result.err(new NotFoundError('Link not found'))
}

/** The `linked` row of one conex entity, if any. */
export async function linkOf(
	provider: ProviderId,
	entityType: LinkEntityType,
	entityId: number,
): Promise<ExternalLinkRow | null> {
	return (
		(
			await getDb()
				.select()
				.from(external_links)
				.where(
					and(
						eq(external_links.provider, provider),
						eq(external_links.entity_type, entityType),
						eq(external_links.entity_id, entityId),
						eq(external_links.state, 'linked'),
					),
				)
				.orderBy(asc(external_links.id))
				.limit(1)
		)[0] ?? null
	)
}

/** Entity type external tenants of the provider link to: `tenant` or `site`. */
export function tenantLevel(provider: ProviderId): 'tenant' | 'site' {
	return providerDefinition(provider).capabilities.link_level
}

/** A `linked` external-tenant link with the conex tenant (and site) it covers. */
export interface ScopeLink {
	link: ExternalLinkRow
	/** Linked tenant, or the tenant of the linked site (null for a tenant-less site). */
	tenant_id: number | null
	/** Linked site (`link_level: 'site'`), else null. */
	site_id: number | null
}

/**
 * Every `linked` external-tenant link of the provider, oldest first, limited
 * to the conex tenants in `tenantIds` when given. Site links count for the
 * tenant of their site, so a tenant may have one per site.
 */
export async function scopeLinks(
	provider: ProviderId,
	tenantIds?: readonly number[],
): Promise<ScopeLink[]> {
	if (tenantIds !== undefined && tenantIds.length === 0) {
		return []
	}
	if (tenantLevel(provider) === 'tenant') {
		const rows = await getDb()
			.select()
			.from(external_links)
			.where(
				and(
					eq(external_links.provider, provider),
					eq(external_links.entity_type, 'tenant'),
					eq(external_links.state, 'linked'),
					tenantIds === undefined
						? undefined
						: inArray(external_links.entity_id, [...tenantIds]),
				),
			)
			.orderBy(asc(external_links.id))
		return rows.map((link) => ({ link, tenant_id: link.entity_id, site_id: null }))
	}
	const rows = await getDb()
		.select({ link: external_links, tenant_id: sites.tenant_id, site_id: sites.id })
		.from(external_links)
		.innerJoin(sites, eq(sites.id, external_links.entity_id))
		.where(
			and(
				eq(external_links.provider, provider),
				eq(external_links.entity_type, 'site'),
				eq(external_links.state, 'linked'),
				tenantIds === undefined ? undefined : inArray(sites.tenant_id, [...tenantIds]),
			),
		)
		.orderBy(asc(external_links.id))
	return rows
}

/** External-tenant links covering a conex tenant, oldest first (see {@link scopeLinks}). */
export async function tenantLinks(
	provider: ProviderId,
	tenantId: number,
): Promise<ExternalLinkRow[]> {
	return (await scopeLinks(provider, [tenantId])).map((s) => s.link)
}

/**
 * External-tenant links a conex device is matched against: those of its
 * tenant, or the one of its site for providers with `link_level: 'site'`.
 */
export async function deviceScopeLinks(
	provider: ProviderId,
	deviceId: number,
): Promise<ExternalLinkRow[]> {
	const device = (
		await getDb()
			.select({ tenant_id: devices.tenant_id, site_id: devices.site_id })
			.from(devices)
			.where(eq(devices.id, deviceId))
			.limit(1)
	)[0]
	if (!device) {
		return []
	}
	if (tenantLevel(provider) === 'tenant') {
		return device.tenant_id === null ? [] : tenantLinks(provider, device.tenant_id)
	}
	const link = device.site_id === null ? null : await linkOf(provider, 'site', device.site_id)
	return link ? [link] : []
}

export interface LinkInput {
	entity_type: LinkEntityType
	entity_id: number
	external_id: string
	external_tenant_id: string | null
}

type NewLink = Omit<ExternalLinkRow, 'id' | 'created_at'>

/**
 * Writes a link row, replacing every other row of the same provider and
 * entity type for the same external object or the same conex entity.
 */
async function replaceLink(link: NewLink): Promise<Result<ExternalLinkRow, Error>> {
	return tryWrite(() =>
		withTransaction(async () => {
			const db = getDb()
			await db
				.delete(external_links)
				.where(
					and(
						eq(external_links.provider, link.provider),
						eq(external_links.entity_type, link.entity_type),
						or(
							eq(external_links.external_id, link.external_id),
							link.entity_id === null
								? undefined
								: eq(external_links.entity_id, link.entity_id),
						),
					),
				)
			const row = (
				await db
					.insert(external_links)
					.values({ ...link, created_at: nowSeconds() })
					.returning()
			)[0]
			if (!row) {
				throw new Error('Link insert returned no row')
			}
			return row
		}),
	)
}

/**
 * Links an entity to an external object. Any other row for the external
 * object is replaced, and so is the entity's previous link (one-to-one per
 * provider).
 */
export function setLink(
	provider: ProviderId,
	input: LinkInput,
	method: 'manual' | 'auto',
	userId: number | null,
): Promise<Result<ExternalLinkRow, Error>> {
	return replaceLink({
		provider,
		entity_type: input.entity_type,
		entity_id: input.entity_id,
		external_id: input.external_id,
		external_tenant_id: input.external_tenant_id,
		state: 'linked',
		method,
		created_by: userId,
	})
}

/** Marks an external object as intentionally not in conex. */
export function ignoreExternal(
	provider: ProviderId,
	entityType: LinkEntityType,
	externalId: string,
	externalTenantId: string | null,
	userId: number,
): Promise<Result<ExternalLinkRow, Error>> {
	return replaceLink({
		provider,
		entity_type: entityType,
		entity_id: null,
		external_id: externalId,
		external_tenant_id: externalTenantId,
		state: 'ignored',
		method: 'manual',
		created_by: userId,
	})
}

/**
 * Synthetic `external_id` for a conex entity ignored as missing in the
 * external system. Real device ids are `pc:<n>` or `periphery:<n>`, tenant
 * and employee ids are numeric, so the `conex:` prefix cannot collide. The unique index on
 * `(provider, entity_type, external_id)` stays satisfied (one row per
 * ignored entity), and `setLink`/`deleteLink` keep working: linking the
 * entity deletes this row by `entity_id`, deleting the entity deletes it in
 * the service layer.
 */
function localIgnoreExternalId(entityType: LinkEntityType, entityId: number): string {
	return `conex:${entityType}:${entityId}`
}

/**
 * Marks a conex entity as intentionally absent from the external system
 * (suppresses its `*_missing_in_external` / `tenant_unlinked` finding). Replaces any
 * previous link row of that entity.
 */
export function ignoreLocal(
	provider: ProviderId,
	entityType: LinkEntityType,
	entityId: number,
	externalTenantId: string | null,
	userId: number,
): Promise<Result<ExternalLinkRow, Error>> {
	return replaceLink({
		provider,
		entity_type: entityType,
		entity_id: entityId,
		external_id: localIgnoreExternalId(entityType, entityId),
		external_tenant_id: externalTenantId,
		state: 'ignored',
		method: 'manual',
		created_by: userId,
	})
}

export async function deleteLink(
	provider: ProviderId,
	id: number,
): Promise<Result<ExternalLinkRow, Error>> {
	const current = await getLink(provider, id)
	if (Result.isError(current)) {
		return current
	}
	const deleted = await tryWrite(() =>
		getDb().delete(external_links).where(eq(external_links.id, id)),
	)
	return Result.isError(deleted) ? deleted : current
}
