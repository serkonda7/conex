/**
 * `integrations` table: one row per provider, created by an admin with a
 * working login. Secrets are encrypted at rest (`secrets.ts`) and never
 * returned: the JSON shape only says whether they are set.
 */
import { Result } from 'better-result'
import { and, desc, eq } from 'drizzle-orm'
import type {
	IntegrationCreate,
	IntegrationJson,
	IntegrationTest,
	IntegrationUpdate,
	IntegrationProvider as ProviderId,
	SyncRunJson,
} from 'shared/src/schemas'
import * as v from 'valibot'
import { getDb, withTransaction } from '../db/connection'
import { DuplicateError, isUniqueViolation, NotFoundError, ValidationError } from '../db/errors'
import { errOf } from '../db/list'
import { external_links, external_objects, integrations, sync_runs } from '../schema'
import { nowSeconds } from '../util/time'
import { buildProvider } from './registry'
import { decryptSecrets, encryptSecrets, type IntegrationSecrets } from './secrets'

export type IntegrationRow = typeof integrations.$inferSelect
export type SyncRunRow = typeof sync_runs.$inferSelect

const CountsSchema = v.object({
	tenants: v.optional(v.number(), 0),
	devices: v.optional(v.number(), 0),
	auto_linked: v.optional(v.number(), 0),
})

export function syncRunJson(row: SyncRunRow): SyncRunJson {
	const counts = v.safeParse(CountsSchema, row.counts ?? {})
	return {
		id: row.id,
		provider: row.provider as ProviderId,
		tenant_id: row.tenant_id,
		started_at: row.started_at,
		finished_at: row.finished_at,
		state: row.state as SyncRunJson['state'],
		error: row.error,
		counts: counts.success ? counts.output : { tenants: 0, devices: 0, auto_linked: 0 },
	}
}

async function lastSync(provider: string): Promise<SyncRunJson | null> {
	const row = (
		await getDb()
			.select()
			.from(sync_runs)
			.where(eq(sync_runs.provider, provider))
			.orderBy(desc(sync_runs.started_at), desc(sync_runs.id))
			.limit(1)
	)[0]
	return row ? syncRunJson(row) : null
}

async function toJson(row: IntegrationRow): Promise<IntegrationJson> {
	const secrets = decryptSecrets(row.secrets)
	return {
		id: row.id,
		provider: row.provider as ProviderId,
		base_url: row.base_url,
		username: row.username,
		has_password: Result.isOk(secrets) && secrets.value.password !== '',
		has_erp_token: Result.isOk(secrets) && secrets.value.erp_token !== '',
		enabled: row.enabled === 1,
		created_at: row.created_at,
		updated_at: row.updated_at,
		last_login_ok_at: row.last_login_ok_at,
		last_error: Result.isError(secrets) ? secrets.error.message : row.last_error,
		last_sync: await lastSync(row.provider),
	}
}

export async function listIntegrations(): Promise<IntegrationJson[]> {
	const rows = await getDb().select().from(integrations).orderBy(integrations.provider)
	return Promise.all(rows.map(toJson))
}

export async function getIntegrationRow(
	provider: ProviderId,
): Promise<Result<IntegrationRow, Error>> {
	const row = (
		await getDb()
			.select()
			.from(integrations)
			.where(eq(integrations.provider, provider))
			.limit(1)
	)[0]
	if (!row) {
		return Result.err(new NotFoundError('Integration not configured'))
	}
	return Result.ok(row)
}

/** Start time of the last successful run; reused as the incremental cursor. */
export async function lastSuccessfulSyncStartedAt(provider: ProviderId): Promise<number | null> {
	const row = (
		await getDb()
			.select({ started_at: sync_runs.started_at })
			.from(sync_runs)
			.where(and(eq(sync_runs.provider, provider), eq(sync_runs.state, 'ok')))
			.orderBy(desc(sync_runs.started_at), desc(sync_runs.id))
			.limit(1)
	)[0]
	return row?.started_at ?? null
}

export async function getIntegration(
	provider: ProviderId,
): Promise<Result<IntegrationJson, Error>> {
	const row = await getIntegrationRow(provider)
	if (Result.isError(row)) {
		return row
	}
	return Result.ok(await toJson(row.value))
}

/** Logs in with every credential; a refusal becomes a 422 with the reason. */
async function verify(
	provider: ProviderId,
	base_url: string,
	username: string,
	secrets: IntegrationSecrets,
): Promise<Result<void, Error>> {
	const instance = buildProvider(provider, { base_url, username, ...secrets })
	const res = await instance.verify()
	if (Result.isError(res)) {
		return Result.err(new ValidationError(res.error.message))
	}
	return Result.ok(undefined)
}

export async function createIntegration(
	input: IntegrationCreate,
	userId: number,
): Promise<Result<IntegrationJson, Error>> {
	const existing = await getIntegrationRow(input.provider)
	if (Result.isOk(existing)) {
		return Result.err(new DuplicateError('This integration already exists'))
	}
	const secrets = { password: input.password, erp_token: input.erp_token }
	const ok = await verify(input.provider, input.base_url, input.username, secrets)
	if (Result.isError(ok)) {
		return ok
	}
	const now = nowSeconds()
	try {
		const row = (
			await getDb()
				.insert(integrations)
				.values({
					provider: input.provider,
					base_url: input.base_url,
					username: input.username,
					secrets: encryptSecrets(secrets),
					created_by: userId,
					created_at: now,
					updated_at: now,
					last_login_ok_at: now,
				})
				.returning()
		)[0]
		if (!row) {
			return Result.err(new Error('Integration insert returned no row'))
		}
		return Result.ok(await toJson(row))
	} catch (e) {
		if (isUniqueViolation(e)) {
			return Result.err(new DuplicateError('This integration already exists'))
		}
		return Result.err(errOf(e))
	}
}

/** Stored secrets overlaid with the given ones; a broken store counts as empty. */
function mergedSecrets(
	row: IntegrationRow | null,
	patch: { password?: string; erp_token?: string },
): IntegrationSecrets {
	const stored = row ? decryptSecrets(row.secrets) : null
	const base = stored && Result.isOk(stored) ? stored.value : { password: '', erp_token: '' }
	return {
		password: patch.password ?? base.password,
		erp_token: patch.erp_token ?? base.erp_token,
	}
}

function missingSecret(secrets: IntegrationSecrets): ValidationError | null {
	if (secrets.password === '') {
		return new ValidationError('Password is required')
	}
	if (secrets.erp_token === '') {
		return new ValidationError('ERP API token is required')
	}
	return null
}

export async function updateIntegration(
	provider: ProviderId,
	patch: IntegrationUpdate,
): Promise<Result<IntegrationJson, Error>> {
	const current = await getIntegrationRow(provider)
	if (Result.isError(current)) {
		return current
	}
	const row = current.value
	const secrets = mergedSecrets(row, patch)
	const base_url = patch.base_url ?? row.base_url
	const username = patch.username ?? row.username
	const credentialsChanged =
		base_url !== row.base_url ||
		username !== row.username ||
		patch.password !== undefined ||
		patch.erp_token !== undefined
	const now = nowSeconds()
	if (credentialsChanged) {
		const missing = missingSecret(secrets)
		if (missing) {
			return Result.err(missing)
		}
		const ok = await verify(provider, base_url, username, secrets)
		if (Result.isError(ok)) {
			return ok
		}
	}
	try {
		const updated = (
			await getDb()
				.update(integrations)
				.set({
					base_url,
					username,
					secrets: encryptSecrets(secrets),
					...(patch.enabled !== undefined ? { enabled: patch.enabled ? 1 : 0 } : {}),
					updated_at: now,
					...(credentialsChanged ? { last_login_ok_at: now, last_error: null } : {}),
				})
				.where(eq(integrations.id, row.id))
				.returning()
		)[0]
		if (!updated) {
			return Result.err(new NotFoundError('Integration not configured'))
		}
		return Result.ok(await toJson(updated))
	} catch (e) {
		return Result.err(errOf(e))
	}
}

/** "Test connection": verifies unsaved form values, nothing is stored. */
export async function testIntegration(
	provider: ProviderId,
	input: IntegrationTest,
): Promise<Result<void, Error>> {
	const current = await getIntegrationRow(provider)
	const row = Result.isOk(current) ? current.value : null
	const secrets = mergedSecrets(row, input)
	const missing = missingSecret(secrets)
	if (missing) {
		return Result.err(missing)
	}
	return verify(provider, input.base_url, input.username, secrets)
}

/** Deletes the integration with its links, snapshot and sync history. */
export async function deleteIntegration(
	provider: ProviderId,
): Promise<Result<IntegrationJson, Error>> {
	const current = await getIntegration(provider)
	if (Result.isError(current)) {
		return current
	}
	try {
		await withTransaction(async () => {
			const db = getDb()
			await db.delete(external_links).where(eq(external_links.provider, provider))
			await db.delete(external_objects).where(eq(external_objects.provider, provider))
			await db.delete(sync_runs).where(eq(sync_runs.provider, provider))
			await db.delete(integrations).where(eq(integrations.provider, provider))
		})
	} catch (e) {
		return Result.err(errOf(e))
	}
	return Result.ok(current.value)
}

/** Records the outcome of the last login (sync runs). */
export async function recordConnection(provider: ProviderId, error: string | null): Promise<void> {
	await getDb()
		.update(integrations)
		.set(
			error === null
				? { last_login_ok_at: nowSeconds(), last_error: null }
				: { last_error: error },
		)
		.where(eq(integrations.provider, provider))
}

/** Provider instance with decrypted credentials, for one sync run. */
export function providerFor(row: IntegrationRow): Result<ReturnType<typeof buildProvider>, Error> {
	const secrets = decryptSecrets(row.secrets)
	if (Result.isError(secrets)) {
		return secrets
	}
	return Result.ok(
		buildProvider(row.provider as ProviderId, {
			base_url: row.base_url,
			username: row.username,
			...secrets.value,
		}),
	)
}
