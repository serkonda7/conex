/**
 * `external_links`: which conex tenant/device is which external object, plus
 * external objects marked as intentionally absent (`ignored`). An external
 * object has at most one row per entity type; linking or ignoring it again
 * replaces that row. Route handlers do the RBAC/scope checks.
 */
import { Result } from 'better-result'
import { and, eq } from 'drizzle-orm'
import type {
	ExternalLinkJson,
	LinkEntityType,
	IntegrationProvider as ProviderId,
} from 'shared/src/schemas'
import { getDb, withTransaction } from '../db/connection'
import { NotFoundError } from '../db/errors'
import { errOf } from '../db/list'
import { external_links } from '../schema'
import { nowSeconds } from '../util/time'

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
				.limit(1)
		)[0] ?? null
	)
}

export interface LinkInput {
	entity_type: LinkEntityType
	entity_id: number
	external_id: string
	external_tenant_id: string | null
}

/**
 * Links an entity to an external object. The entity's previous link and any
 * other row for the external object are replaced (one-to-one per provider).
 */
export async function setLink(
	provider: ProviderId,
	input: LinkInput,
	method: 'manual' | 'auto',
	userId: number | null,
): Promise<Result<ExternalLinkRow, Error>> {
	try {
		const row = await withTransaction(async () => {
			const db = getDb()
			await db
				.delete(external_links)
				.where(
					and(
						eq(external_links.provider, provider),
						eq(external_links.entity_type, input.entity_type),
						eq(external_links.entity_id, input.entity_id),
					),
				)
			await db
				.delete(external_links)
				.where(
					and(
						eq(external_links.provider, provider),
						eq(external_links.entity_type, input.entity_type),
						eq(external_links.external_id, input.external_id),
					),
				)
			return (
				await db
					.insert(external_links)
					.values({
						provider,
						entity_type: input.entity_type,
						entity_id: input.entity_id,
						external_id: input.external_id,
						external_tenant_id: input.external_tenant_id,
						state: 'linked',
						method,
						created_by: userId,
						created_at: nowSeconds(),
					})
					.returning()
			)[0]
		})
		return row ? Result.ok(row) : Result.err(new Error('Link insert returned no row'))
	} catch (e) {
		return Result.err(errOf(e))
	}
}

/** Marks an external object as intentionally not in conex. */
export async function ignoreExternal(
	provider: ProviderId,
	entityType: LinkEntityType,
	externalId: string,
	externalTenantId: string | null,
	userId: number,
): Promise<Result<ExternalLinkRow, Error>> {
	try {
		const row = await withTransaction(async () => {
			const db = getDb()
			await db
				.delete(external_links)
				.where(
					and(
						eq(external_links.provider, provider),
						eq(external_links.entity_type, entityType),
						eq(external_links.external_id, externalId),
					),
				)
			return (
				await db
					.insert(external_links)
					.values({
						provider,
						entity_type: entityType,
						entity_id: null,
						external_id: externalId,
						external_tenant_id: externalTenantId,
						state: 'ignored',
						method: 'manual',
						created_by: userId,
						created_at: nowSeconds(),
					})
					.returning()
			)[0]
		})
		return row ? Result.ok(row) : Result.err(new Error('Link insert returned no row'))
	} catch (e) {
		return Result.err(errOf(e))
	}
}

/**
 * Synthetic `external_id` for a conex entity ignored as missing in the
 * external system. Real device ids are `pc:<n>` and tenant ids are numeric
 * company ids, so the `conex:` prefix cannot collide. The unique index on
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
 * (suppresses its `device_missing_in_external` finding). Replaces any
 * previous link row of that entity.
 */
export async function ignoreLocal(
	provider: ProviderId,
	entityType: LinkEntityType,
	entityId: number,
	externalTenantId: string | null,
	userId: number,
): Promise<Result<ExternalLinkRow, Error>> {
	try {
		const row = await withTransaction(async () => {
			const db = getDb()
			await db
				.delete(external_links)
				.where(
					and(
						eq(external_links.provider, provider),
						eq(external_links.entity_type, entityType),
						eq(external_links.entity_id, entityId),
					),
				)
			return (
				await db
					.insert(external_links)
					.values({
						provider,
						entity_type: entityType,
						entity_id: entityId,
						external_id: localIgnoreExternalId(entityType, entityId),
						external_tenant_id: externalTenantId,
						state: 'ignored',
						method: 'manual',
						created_by: userId,
						created_at: nowSeconds(),
					})
					.returning()
			)[0]
		})
		return row ? Result.ok(row) : Result.err(new Error('Link insert returned no row'))
	} catch (e) {
		return Result.err(errOf(e))
	}
}

export async function deleteLink(
	provider: ProviderId,
	id: number,
): Promise<Result<ExternalLinkRow, Error>> {
	const current = await getLink(provider, id)
	if (Result.isError(current)) {
		return current
	}
	try {
		await getDb().delete(external_links).where(eq(external_links.id, id))
	} catch (e) {
		return Result.err(errOf(e))
	}
	return Result.ok(current.value)
}
