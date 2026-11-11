/**
 * `external_links`: which conex tenant/device/employee is which external object, plus
 * external objects marked as intentionally absent (`ignored`). An external
 * object has at most one row per entity type; linking or ignoring it again
 * replaces that row. A conex entity has at most one link per provider,
 * except tenants of a provider with `tenant_cardinality: 'many'` (UniFi:
 * several sites per tenant). Route handlers do the RBAC/scope checks.
 */
import { Result } from 'better-result'
import { and, asc, eq, or } from 'drizzle-orm'
import type {
	ExternalLinkJson,
	LinkEntityType,
	IntegrationProvider as ProviderId,
} from 'shared/src/schemas'
import { getDb, withTransaction } from '../db/connection'
import { NotFoundError } from '../db/errors'
import { tryWrite } from '../db/list'
import { external_links } from '../schema'
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

/**
 * The `linked` row of one conex entity, if any. For tenants of a provider
 * with many links per tenant use {@link tenantLinks}; this returns the
 * oldest of them.
 */
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

/** Every `linked` row of a conex tenant, oldest first (at most one unless cardinality `many`). */
export async function tenantLinks(
	provider: ProviderId,
	tenantId: number,
): Promise<ExternalLinkRow[]> {
	return getDb()
		.select()
		.from(external_links)
		.where(
			and(
				eq(external_links.provider, provider),
				eq(external_links.entity_type, 'tenant'),
				eq(external_links.entity_id, tenantId),
				eq(external_links.state, 'linked'),
			),
		)
		.orderBy(asc(external_links.id))
}

export interface LinkInput {
	entity_type: LinkEntityType
	entity_id: number
	external_id: string
	external_tenant_id: string | null
}

type NewLink = Omit<ExternalLinkRow, 'id' | 'created_at'>

/**
 * Whether a new row for `link` replaces the other rows of its conex entity:
 * always, except tenant links of a provider that allows many per tenant.
 */
function replacesEntityRows(link: NewLink): boolean {
	return !(
		link.entity_type === 'tenant' &&
		link.state === 'linked' &&
		providerDefinition(link.provider as ProviderId).capabilities.tenant_cardinality === 'many'
	)
}

/**
 * Writes a link row, replacing every other row of the same provider and
 * entity type for the same external object and, unless the entity may have
 * many links (see {@link replacesEntityRows}), for the same conex entity.
 */
async function replaceLink(link: NewLink): Promise<Result<ExternalLinkRow, Error>> {
	const byEntity = replacesEntityRows(link)
	return tryWrite(() =>
		withTransaction(async () => {
			const db = getDb()
			await db.delete(external_links).where(
				and(
					eq(external_links.provider, link.provider),
					eq(external_links.entity_type, link.entity_type),
					or(
						eq(external_links.external_id, link.external_id),
						link.entity_id === null
							? undefined
							: byEntity
								? eq(external_links.entity_id, link.entity_id)
								: // Many-link tenants keep their other links, but a link ends an ignore.
									and(
										eq(external_links.entity_id, link.entity_id),
										eq(external_links.state, 'ignored'),
									),
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
 * provider, except tenants of a `many` provider, which keep their other links).
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
export function localIgnoreExternalId(entityType: LinkEntityType, entityId: number): string {
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
