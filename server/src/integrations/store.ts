/**
 * `integrations` table: one row per provider, created by an admin with a
 * working login. Secrets are encrypted at rest (`secrets.ts`) and never
 * returned: the JSON shape only says whether they are set.
 */
import { Result } from 'better-result'
import { and, desc, eq, inArray } from 'drizzle-orm'
import {
	INTEGRATION_SECRET_FIELDS,
	type IntegrationCreate,
	type IntegrationJson,
	type IntegrationTest,
	type IntegrationUpdate,
	type IntegrationProvider as ProviderId,
	type SyncRunJson,
} from 'shared/src/schemas'
import * as v from 'valibot'
import { getDb, withTransaction } from '../db/connection'
import { DuplicateError, isUniqueViolation, NotFoundError, ValidationError } from '../db/errors'
import { errOf } from '../db/list'
import { external_links, external_objects, integrations, sync_runs } from '../schema'
import { nowSeconds } from '../util/time'
import { providerDefinition } from './registry'
import { decryptSecrets, emptySecrets, encryptSecrets, type IntegrationSecrets } from './secrets'
import type { IntegrationConfig, IntegrationProvider } from './types'

export type IntegrationRow = typeof integrations.$inferSelect
export type SyncRunRow = typeof sync_runs.$inferSelect

const CountsSchema = v.object({
	tenants: v.optional(v.number(), 0),
	devices: v.optional(v.number(), 0),
	employees: v.optional(v.number(), 0),
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
		counts: counts.success
			? counts.output
			: { tenants: 0, devices: 0, employees: 0, auto_linked: 0 },
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

async function toJson(row: IntegrationRow, last?: SyncRunJson | null): Promise<IntegrationJson> {
	const provider = row.provider as ProviderId
	const secrets = decryptSecrets(provider, row.secrets)
	const secrets_set: Record<string, boolean> = {}
	for (const field of INTEGRATION_SECRET_FIELDS[provider]) {
		secrets_set[field] = Result.isOk(secrets) && secrets.value[field] !== ''
	}
	return {
		id: row.id,
		provider,
		base_url: row.base_url,
		username: row.username,
		settings: row.settings,
		secrets_set,
		capabilities: providerDefinition(provider).capabilities,
		enabled: row.enabled === 1,
		created_at: row.created_at,
		updated_at: row.updated_at,
		last_login_ok_at: row.last_login_ok_at,
		last_error: Result.isError(secrets) ? secrets.error.message : row.last_error,
		last_sync: last === undefined ? await lastSync(row.provider) : last,
	}
}

export async function listIntegrations(): Promise<IntegrationJson[]> {
	const rows = await getDb().select().from(integrations).orderBy(integrations.provider)
	if (rows.length === 0) {
		return []
	}
	// Latest run per provider in one statement (as `lastSync` does for one).
	const runs = await getDb()
		.selectDistinctOn([sync_runs.provider])
		.from(sync_runs)
		.where(
			inArray(
				sync_runs.provider,
				rows.map((row) => row.provider),
			),
		)
		.orderBy(sync_runs.provider, desc(sync_runs.started_at), desc(sync_runs.id))
	const lastOf = new Map(runs.map((run) => [run.provider, syncRunJson(run)]))
	return Promise.all(rows.map((row) => toJson(row, lastOf.get(row.provider) ?? null)))
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

/** Configuration and secret fields of a create/update/test body. */
interface BodyFields {
	base_url?: string
	username?: string
	settings: Record<string, unknown>
	secrets: Partial<IntegrationSecrets>
}

/**
 * Splits a validated body by the provider's secret fields: `base_url` and
 * `username` have columns, other plain fields go to `settings`. Omitted
 * (undefined) fields are left out.
 */
function bodyFields(provider: ProviderId, body: object): BodyFields {
	const secretFields: readonly string[] = INTEGRATION_SECRET_FIELDS[provider]
	const out: BodyFields = { settings: {}, secrets: {} }
	for (const [key, value] of Object.entries(body)) {
		if (value === undefined || key === 'provider' || key === 'enabled') {
			continue
		}
		if (secretFields.includes(key)) {
			;(out.secrets as Record<string, unknown>)[key] = value
		} else if (key === 'base_url' || key === 'username') {
			out[key] = value as string
		} else {
			out.settings[key] = value
		}
	}
	return out
}

function configOf(row: IntegrationRow): IntegrationConfig {
	return { base_url: row.base_url, username: row.username, settings: row.settings }
}

/** Logs in with every credential; a refusal becomes a 422 with the reason. */
async function verify(
	provider: ProviderId,
	config: IntegrationConfig,
	secrets: IntegrationSecrets,
): Promise<Result<void, Error>> {
	const instance = providerDefinition(provider).build(config, secrets)
	if (Result.isError(instance)) {
		return Result.err(new ValidationError(instance.error.message))
	}
	const res = await instance.value.verify()
	if (Result.isError(res)) {
		return Result.err(new ValidationError(res.error.message))
	}
	return Result.ok(undefined)
}

/** Stored secrets overlaid with the given ones; a broken store counts as empty. */
function mergedSecrets(
	provider: ProviderId,
	row: IntegrationRow | null,
	patch: Partial<IntegrationSecrets>,
): IntegrationSecrets {
	const stored = row ? decryptSecrets(provider, row.secrets) : null
	const base = stored && Result.isOk(stored) ? stored.value : emptySecrets(provider)
	return { ...base, ...patch }
}

function missingSecret(provider: ProviderId, secrets: IntegrationSecrets): ValidationError | null {
	const labels: Record<string, string> = providerDefinition(provider).secretLabels
	for (const field of INTEGRATION_SECRET_FIELDS[provider]) {
		if (secrets[field] === '') {
			return new ValidationError(`${labels[field] ?? field} is required`)
		}
	}
	return null
}

export async function createIntegration(
	input: IntegrationCreate,
	userId: number,
): Promise<Result<IntegrationJson, Error>> {
	const existing = await getIntegrationRow(input.provider)
	if (Result.isOk(existing)) {
		return Result.err(new DuplicateError('This integration already exists'))
	}
	const fields = bodyFields(input.provider, input)
	const config: IntegrationConfig = {
		base_url: fields.base_url ?? null,
		username: fields.username ?? null,
		settings: fields.settings,
	}
	const secrets = mergedSecrets(input.provider, null, fields.secrets)
	const missing = missingSecret(input.provider, secrets)
	if (missing) {
		return Result.err(missing)
	}
	const ok = await verify(input.provider, config, secrets)
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
					...config,
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

/** The body's `provider` must name the integration of the route. */
function checkBodyProvider(provider: ProviderId, body: { provider: ProviderId }): Error | null {
	return body.provider === provider
		? null
		: new ValidationError(`Body is for ${body.provider}, not ${provider}`)
}

export async function updateIntegration(
	provider: ProviderId,
	patch: IntegrationUpdate,
): Promise<Result<IntegrationJson, Error>> {
	const mismatch = checkBodyProvider(provider, patch)
	if (mismatch) {
		return Result.err(mismatch)
	}
	const current = await getIntegrationRow(provider)
	if (Result.isError(current)) {
		return current
	}
	const row = current.value
	const fields = bodyFields(provider, patch)
	const secrets = mergedSecrets(provider, row, fields.secrets)
	const config: IntegrationConfig = {
		base_url: fields.base_url ?? row.base_url,
		username: fields.username ?? row.username,
		settings: { ...row.settings, ...fields.settings },
	}
	const credentialsChanged =
		config.base_url !== row.base_url ||
		config.username !== row.username ||
		JSON.stringify(config.settings) !== JSON.stringify(row.settings) ||
		Object.keys(fields.secrets).length > 0
	const now = nowSeconds()
	if (credentialsChanged) {
		const missing = missingSecret(provider, secrets)
		if (missing) {
			return Result.err(missing)
		}
		const ok = await verify(provider, config, secrets)
		if (Result.isError(ok)) {
			return ok
		}
	}
	try {
		const updated = (
			await getDb()
				.update(integrations)
				.set({
					...config,
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
	const mismatch = checkBodyProvider(provider, input)
	if (mismatch) {
		return Result.err(mismatch)
	}
	const current = await getIntegrationRow(provider)
	const row = Result.isOk(current) ? current.value : null
	const fields = bodyFields(provider, input)
	const secrets = mergedSecrets(provider, row, fields.secrets)
	const missing = missingSecret(provider, secrets)
	if (missing) {
		return Result.err(missing)
	}
	return verify(
		provider,
		{
			base_url: fields.base_url ?? null,
			username: fields.username ?? null,
			settings: { ...(row?.settings ?? {}), ...fields.settings },
		},
		secrets,
	)
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

/** Plain configuration plus decrypted secrets of an integration row. */
export function credentialsOf<P extends ProviderId>(
	row: IntegrationRow,
	provider: P,
): Result<{ config: IntegrationConfig; secrets: IntegrationSecrets<P> }, Error> {
	return decryptSecrets(provider, row.secrets).map((secrets) => ({
		config: configOf(row),
		secrets,
	}))
}

/** Provider instance with decrypted credentials, for one sync run. */
export function providerFor(row: IntegrationRow): Result<IntegrationProvider, Error> {
	const provider = row.provider as ProviderId
	return credentialsOf(row, provider).andThen(({ config, secrets }) =>
		providerDefinition(provider).build(config, secrets),
	)
}

/** Provider instance of `row`; a `ValidationError` when the integration is disabled. */
export function enabledProviderFor(row: IntegrationRow): Result<IntegrationProvider, Error> {
	if (!row.enabled) {
		return Result.err(new ValidationError('Integration is disabled'))
	}
	return providerFor(row)
}

/** Provider instance of the enabled integration `provider`. */
export async function enabledProvider(
	provider: ProviderId,
): Promise<Result<IntegrationProvider, Error>> {
	const row = await getIntegrationRow(provider)
	return Result.isError(row) ? row : enabledProviderFor(row.value)
}
