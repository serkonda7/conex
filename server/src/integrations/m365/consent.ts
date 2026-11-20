/**
 * Admin consent of customer tenants to the MSP's multi-tenant Entra app.
 *
 * The consent link carries a signed `state` (conex tenant id plus expiry),
 * so the public callback knows which conex tenant to link. The callback does
 * not trust Entra's `tenant` query parameter: consent counts as given once a
 * token for that tenant works and `/organization` can be read. Only then is
 * the tenant stored, linked and synced.
 */
import { createHmac, timingSafeEqual } from 'node:crypto'
import { Result } from 'better-result'
import type { M365ConsentLinkJson } from 'shared/src/schemas'
import { getConfig } from '../../config'
import { ConflictError, ValidationError } from '../../db/errors'
import { checkTenantExists } from '../../db/list'
import { getConsentStateKey } from '../../keys'
import { nowSeconds } from '../../util/time'
import { setLink } from '../links'
import { mergeTenants } from '../snapshot'
import { enabledProvider } from '../store'
import { startSync } from '../sync'
import { type M365Organization, tenantOf } from './directory'
import { M365Provider } from './provider'
import { type M365TenantRow, upsertM365Tenant } from './tenants'

/** Consent links are sent to customer admins, who may take a while. */
const STATE_TTL_SECONDS = 14 * 24 * 3600

/** Path of the public callback below the API root. */
const CALLBACK_PATH = '/api/integrations/m365/consent'

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

function sign(payload: string): string {
	return createHmac('sha256', getConsentStateKey())
		.update(`m365-consent:${payload}`)
		.digest('base64url')
}

/** `<tenant id>.<expiry>.<signature>` */
export function consentState(tenantId: number, expiresAt: number): string {
	const payload = `${tenantId}.${expiresAt}`
	return `${payload}.${sign(payload)}`
}

/** conex tenant id of a valid, unexpired state. */
export function verifyConsentState(state: string): Result<number, Error> {
	const [tenantRaw, expiryRaw, signature] = state.split('.')
	if (tenantRaw === undefined || expiryRaw === undefined || signature === undefined) {
		return Result.err(new ValidationError('Invalid consent link'))
	}
	const expected = Buffer.from(sign(`${tenantRaw}.${expiryRaw}`))
	const given = Buffer.from(signature)
	if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
		return Result.err(new ValidationError('Invalid consent link'))
	}
	const tenantId = Number(tenantRaw)
	const expiresAt = Number(expiryRaw)
	if (!Number.isInteger(tenantId) || tenantId < 1 || !Number.isInteger(expiresAt)) {
		return Result.err(new ValidationError('Invalid consent link'))
	}
	if (expiresAt < nowSeconds()) {
		return Result.err(new ValidationError('The consent link has expired; ask for a new one'))
	}
	return Result.ok(tenantId)
}

/** Public base URL: `frontendUrl` when configured, else the requesting client's origin. */
function publicBase(origin: string | undefined): Result<string, Error> {
	const base = getConfig().frontendUrl?.trim() || origin
	if (!base) {
		return Result.err(new ValidationError('frontendUrl is not configured'))
	}
	return Result.ok(base.replace(/\/+$/, ''))
}

async function m365Provider(): Promise<Result<M365Provider, Error>> {
	const instance = await enabledProvider('m365')
	if (Result.isError(instance)) {
		return instance
	}
	return instance.value instanceof M365Provider
		? Result.ok(instance.value)
		: Result.err(new Error('Microsoft 365 integration has an unexpected provider'))
}

/** Admin consent link for one conex tenant. */
export async function consentLink(
	tenantId: number,
	origin: string | undefined,
): Promise<Result<M365ConsentLinkJson, Error>> {
	const tenant = await checkTenantExists(tenantId)
	if (Result.isError(tenant)) {
		return tenant
	}
	const provider = await m365Provider()
	if (Result.isError(provider)) {
		return provider
	}
	const base = publicBase(origin)
	if (Result.isError(base)) {
		return base
	}
	const redirectUri = `${base.value}${CALLBACK_PATH}`
	const expiresAt = nowSeconds() + STATE_TTL_SECONDS
	const url = new URL('https://login.microsoftonline.com/organizations/v2.0/adminconsent')
	url.searchParams.set('client_id', provider.value.clientId)
	url.searchParams.set('scope', 'https://graph.microsoft.com/.default')
	url.searchParams.set('redirect_uri', redirectUri)
	url.searchParams.set('state', consentState(tenantId, expiresAt))
	return Result.ok({ url: url.toString(), redirect_uri: redirectUri, expires_at: expiresAt })
}

/**
 * Reads `/organization` in the tenant. Right after consent Entra may still
 * refuse tokens for a few seconds, so the callback retries.
 */
async function proveConsent(
	provider: M365Provider,
	msTenant: string,
	attempts: number,
): Promise<Result<M365Organization, Error>> {
	let org = await provider.directory(msTenant).organization()
	for (let n = 1; n < attempts && Result.isError(org); n++) {
		await Bun.sleep(3000)
		org = await provider.directory(msTenant).organization()
	}
	return org
}

/**
 * Stores a tenant whose consent was proven, links it to the conex tenant and
 * starts a sync for that tenant (a running sync picks it up next time).
 */
async function register(
	msTenant: string,
	tenantId: number,
	method: 'manual' | 'auto',
	userId: number | null,
	attempts: number,
): Promise<Result<M365TenantRow, Error>> {
	const tenant = await checkTenantExists(tenantId)
	if (Result.isError(tenant)) {
		return tenant
	}
	const provider = await m365Provider()
	if (Result.isError(provider)) {
		return provider
	}
	const org = await proveConsent(provider.value, msTenant, attempts)
	if (Result.isError(org)) {
		return Result.err(new ValidationError(org.error.message))
	}
	if (GUID.test(msTenant) && org.value.ms_tenant_id !== msTenant) {
		return Result.err(new ValidationError('Microsoft returned a different tenant'))
	}
	const row = await upsertM365Tenant(org.value)
	if (Result.isError(row)) {
		return row
	}
	// In the snapshot right away, so the tenant card shows it before the sync.
	await mergeTenants('m365', [tenantOf(org.value)], nowSeconds())
	const link = await setLink(
		'm365',
		{
			entity_type: 'tenant',
			entity_id: tenantId,
			external_id: org.value.ms_tenant_id,
			external_tenant_id: org.value.ms_tenant_id,
		},
		method,
		userId,
	)
	if (Result.isError(link)) {
		return link
	}
	const sync = await startSync('m365', tenantId)
	if (Result.isError(sync) && !(sync.error instanceof ConflictError)) {
		console.error('M365 sync after consent failed to start:', sync.error)
	}
	return row
}

/** Public consent callback: `state` from the link, `tenant` from Entra. */
export async function completeConsent(
	state: string,
	msTenant: string,
): Promise<Result<M365TenantRow, Error>> {
	const tenantId = verifyConsentState(state)
	if (Result.isError(tenantId)) {
		return tenantId
	}
	const id = msTenant.trim().toLowerCase()
	if (!GUID.test(id)) {
		return Result.err(new ValidationError('Microsoft did not return a tenant id'))
	}
	return register(id, tenantId.value, 'auto', null, 3)
}

/** Manual connect for consent given another way (tenant id or domain). */
export async function connectTenant(
	msTenant: string,
	tenantId: number,
	userId: number,
): Promise<Result<M365TenantRow, Error>> {
	return register(msTenant, tenantId, 'manual', userId, 1)
}
