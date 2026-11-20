/**
 * `m365_tenants`: customer Entra tenants that consented to the MSP's app.
 * Graph cannot list them, so this table is the source of the sync's tenant
 * list. Rows are only added after `/organization` was read in the tenant.
 */
import { Result } from 'better-result'
import { and, asc, eq } from 'drizzle-orm'
import type { M365TenantJson } from 'shared/src/schemas'
import { getDb } from '../../db/connection'
import { NotFoundError } from '../../db/errors'
import { errOf } from '../../db/list'
import { external_links, m365_tenants } from '../../schema'
import { nowSeconds } from '../../util/time'
import type { M365Organization } from './directory'

export type M365TenantRow = typeof m365_tenants.$inferSelect

export async function listM365TenantRows(): Promise<M365TenantRow[]> {
	return getDb()
		.select()
		.from(m365_tenants)
		.orderBy(asc(m365_tenants.display_name), asc(m365_tenants.ms_tenant_id))
}

/** Every consented tenant with the conex tenant linked to it. */
export async function listM365Tenants(): Promise<M365TenantJson[]> {
	const rows = await listM365TenantRows()
	const links = await getDb()
		.select({ external_id: external_links.external_id, entity_id: external_links.entity_id })
		.from(external_links)
		.where(
			and(
				eq(external_links.provider, 'm365'),
				eq(external_links.entity_type, 'tenant'),
				eq(external_links.state, 'linked'),
			),
		)
	const linked = new Map(links.map((link) => [link.external_id, link.entity_id]))
	return rows.map((row) => ({
		ms_tenant_id: row.ms_tenant_id,
		display_name: row.display_name,
		default_domain: row.default_domain,
		consented_at: row.consented_at,
		last_ok_at: row.last_ok_at,
		last_error: row.last_error,
		linked_tenant_id: linked.get(row.ms_tenant_id) ?? null,
	}))
}

/** Adds the tenant (or refreshes its name) after consent was proven. */
export async function upsertM365Tenant(
	org: M365Organization,
): Promise<Result<M365TenantRow, Error>> {
	const now = nowSeconds()
	try {
		const row = (
			await getDb()
				.insert(m365_tenants)
				.values({
					ms_tenant_id: org.ms_tenant_id,
					display_name: org.display_name,
					default_domain: org.default_domain,
					consented_at: now,
					last_ok_at: now,
				})
				.onConflictDoUpdate({
					target: m365_tenants.ms_tenant_id,
					set: {
						display_name: org.display_name,
						default_domain: org.default_domain,
						last_ok_at: now,
						last_error: null,
					},
				})
				.returning()
		)[0]
		return row ? Result.ok(row) : Result.err(new Error('M365 tenant upsert returned no row'))
	} catch (e) {
		return Result.err(errOf(e))
	}
}

/** Outcome of one tenant's fetch in a sync: refreshed name, or the error. */
export async function recordM365Fetch(
	msTenantId: string,
	outcome: { org: M365Organization } | { error: string },
): Promise<void> {
	await getDb()
		.update(m365_tenants)
		.set(
			'org' in outcome
				? {
						display_name: outcome.org.display_name,
						default_domain: outcome.org.default_domain,
						last_ok_at: nowSeconds(),
						last_error: null,
					}
				: { last_error: outcome.error },
		)
		.where(eq(m365_tenants.ms_tenant_id, msTenantId))
}

/**
 * Forgets a consented tenant; the next sync drops it from the snapshot.
 * Consent itself stays in Entra until the customer removes the app.
 */
export async function deleteM365Tenant(msTenantId: string): Promise<Result<void, Error>> {
	const deleted = await getDb()
		.delete(m365_tenants)
		.where(eq(m365_tenants.ms_tenant_id, msTenantId))
		.returning({ id: m365_tenants.ms_tenant_id })
	return deleted.length > 0
		? Result.ok(undefined)
		: Result.err(new NotFoundError('M365 tenant not found'))
}

export async function deleteAllM365Tenants(): Promise<void> {
	await getDb().delete(m365_tenants)
}
