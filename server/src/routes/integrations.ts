import { vValidator } from '@hono/valibot-validator'
import { Result } from 'better-result'
import { eq } from 'drizzle-orm'
import { type Context, Hono } from 'hono'
import {
	ExternalIgnoreSchema,
	ExternalLinkCreateSchema,
	type ExternalTenantListItem,
	ExternalTenantQuerySchema,
	IntegrationCreateSchema,
	IntegrationEntityParamsSchema,
	IntegrationParamsSchema,
	IntegrationReportQuerySchema,
	IntegrationSyncQuerySchema,
	IntegrationTestSchema,
	IntegrationUpdateSchema,
	LinkBoardQuerySchema,
	type IntegrationProvider as ProviderId,
	TicketCreateSchema,
} from 'shared/src/schemas'
import {
	checkTenant,
	listTenantScope,
	requestUser,
	requireGlobalPermission,
	requirePermission,
	scopeTenantId,
} from '../authz'
import { getDb } from '../db/connection'
import { ForbiddenError, NotFoundError } from '../db/errors'
import { deviceTenant } from '../db/owners'
import { deviceBoard, tenantBoard } from '../integrations/board'
import {
	deleteLink,
	getLink,
	ignoreExternal,
	linkJson,
	linkOf,
	listLinks,
	setLink,
} from '../integrations/links'
import { buildReport, deviceStatus, tenantStatus } from '../integrations/report'
import { readDevice, readTenant, readTenants } from '../integrations/snapshot'
import {
	createIntegration,
	deleteIntegration,
	getIntegration,
	getIntegrationRow,
	listIntegrations,
	testIntegration,
	updateIntegration,
} from '../integrations/store'
import { getSyncRun, startSync } from '../integrations/sync'
import { createTicket } from '../integrations/tickets'
import { authMiddleware } from '../middleware/auth'
import { requirePermissionMiddleware } from '../middleware/permissions'
import { onValidationError } from '../middleware/validation'
import { tenants } from '../schema'
import { jsonError } from '../util/http'
import { sendCreated, sendResult } from '../util/result_response'

/** 404 response when the provider has no integration row, else null. */
async function requireConfigured(c: Context, provider: ProviderId): Promise<Response | null> {
	const row = await getIntegrationRow(provider)
	return Result.isError(row) ? sendResult(c, row) : null
}

/**
 * Write gate for an ignored external device (no conex device to scope by):
 * scoped editors may only touch devices of the company linked to their
 * own tenant.
 */
async function checkExternalDeviceWrite(
	c: Context,
	provider: ProviderId,
	externalTenantId: string | null,
): Promise<Response | null> {
	const scope = scopeTenantId(requestUser(c))
	if (scope === null) {
		return null
	}
	const own = await linkOf(provider, 'tenant', scope)
	if (!own || externalTenantId === null || own.external_id !== externalTenantId) {
		return jsonError(c, 'Forbidden: outside your tenant scope', 403)
	}
	return null
}

/**
 * Integrations: `integrations.manage` configures and lists providers
 * (credentials verified before saving, secrets never returned), runs syncs
 * and edits links; the reports and boards only need `view`. Links of
 * tenants are global-write like tenants themselves; device links follow the
 * device's tenant scope.
 * External company lists are global-only: scoped users must not see other
 * customers. `tickets.create` opens tickets for tenants in scope.
 */
export const integrationsApp = new Hono()
	.use(authMiddleware)
	.get('/', requirePermissionMiddleware('integrations.manage'), async (c) =>
		c.json(await listIntegrations()),
	)
	.post(
		'/',
		requirePermissionMiddleware('integrations.manage'),
		vValidator('json', IntegrationCreateSchema, onValidationError),
		async (c) => {
			const created = await createIntegration(c.req.valid('json'), requestUser(c).id)
			if (Result.isOk(created)) {
				// Fetch the company list right away so tenants can be linked.
				await startSync(created.value.provider, null)
			}
			return sendCreated(c, created)
		},
	)
	.get(
		'/:provider',
		requirePermissionMiddleware('integrations.manage'),
		vValidator('param', IntegrationParamsSchema, onValidationError),
		async (c) => sendResult(c, await getIntegration(c.req.valid('param').provider)),
	)
	.patch(
		'/:provider',
		requirePermissionMiddleware('integrations.manage'),
		vValidator('param', IntegrationParamsSchema, onValidationError),
		vValidator('json', IntegrationUpdateSchema, onValidationError),
		async (c) =>
			sendResult(
				c,
				await updateIntegration(c.req.valid('param').provider, c.req.valid('json')),
			),
	)
	.delete(
		'/:provider',
		requirePermissionMiddleware('integrations.manage'),
		vValidator('param', IntegrationParamsSchema, onValidationError),
		async (c) => sendResult(c, await deleteIntegration(c.req.valid('param').provider)),
	)
	.post(
		'/:provider/test',
		requirePermissionMiddleware('integrations.manage'),
		vValidator('param', IntegrationParamsSchema, onValidationError),
		vValidator('json', IntegrationTestSchema, onValidationError),
		async (c) => {
			const res = await testIntegration(c.req.valid('param').provider, c.req.valid('json'))
			return sendResult(
				c,
				res.map(() => ({ ok: true })),
			)
		},
	)
	.post(
		'/:provider/sync',
		vValidator('param', IntegrationParamsSchema, onValidationError),
		vValidator('query', IntegrationSyncQuerySchema, onValidationError),
		async (c) => {
			// Syncs create and update inventory, so they need `edit` as well.
			const denied =
				requirePermission(c, 'integrations.manage') ?? requirePermission(c, 'edit')
			if (denied) {
				return denied
			}
			const query = c.req.valid('query')
			if (query.clean === 'true') {
				const globalDenied = requireGlobalPermission(c, 'integrations.manage')
				if (globalDenied) {
					return globalDenied
				}
			}
			// Scoped users may only sync their own tenant.
			const scope = scopeTenantId(requestUser(c))
			const queryTenant = query.tenant
			if (scope !== null && queryTenant !== undefined && queryTenant !== scope) {
				return jsonError(c, 'Forbidden: outside your tenant scope', 403)
			}
			const tenant = scope ?? queryTenant ?? null
			return sendResult(
				c,
				await startSync(c.req.valid('param').provider, tenant, query.clean === 'true'),
				202,
			)
		},
	)
	.post(
		'/:provider/tickets',
		requirePermissionMiddleware('tickets.create'),
		vValidator('param', IntegrationParamsSchema, onValidationError),
		vValidator('json', TicketCreateSchema, onValidationError),
		async (c) => {
			const input = c.req.valid('json')
			const denied = checkTenant(c, input.tenant_id)
			if (denied) {
				return denied
			}
			return sendResult(c, await createTicket(c.req.valid('param').provider, input), 201)
		},
	)
	.get(
		'/:provider/sync/:id',
		requirePermissionMiddleware('view'),
		vValidator('param', IntegrationEntityParamsSchema, onValidationError),
		async (c) => {
			const { provider, id } = c.req.valid('param')
			return sendResult(c, await getSyncRun(provider, id))
		},
	)
	.get(
		'/:provider/tenants',
		requirePermissionMiddleware('view'),
		vValidator('param', IntegrationParamsSchema, onValidationError),
		vValidator('query', ExternalTenantQuerySchema, onValidationError),
		async (c) => {
			if (scopeTenantId(requestUser(c)) !== null) {
				return sendResult(
					c,
					Result.err(
						new ForbiddenError(
							'Forbidden: tenant-scoped users cannot list external tenants',
						),
					),
				)
			}
			const { provider } = c.req.valid('param')
			const missing = await requireConfigured(c, provider)
			if (missing) {
				return missing
			}
			const needle = c.req.valid('query').search.toLowerCase()
			const rows = new Map<string, { tenant: number | null; ignored: boolean }>()
			for (const link of await listLinks(provider, 'tenant')) {
				rows.set(link.external_id, {
					tenant: link.state === 'linked' ? link.entity_id : null,
					ignored: link.state === 'ignored',
				})
			}
			const items: ExternalTenantListItem[] = [...(await readTenants(provider)).values()]
				// Inactive and private customers are not offered, except linked ones.
				.filter(
					(t) =>
						(t.active && t.private !== true) ||
						(rows.get(t.external_id)?.tenant ?? null) !== null,
				)
				.filter(
					(t) =>
						needle === '' ||
						t.name.toLowerCase().includes(needle) ||
						(t.display_id ?? '').toLowerCase().includes(needle),
				)
				.sort((a, b) => a.name.localeCompare(b.name))
				.slice(0, 100)
				.map((t) => ({
					...t,
					linked_tenant_id: rows.get(t.external_id)?.tenant ?? null,
					ignored: rows.get(t.external_id)?.ignored ?? false,
				}))
			return c.json(items)
		},
	)
	.get(
		'/:provider/report',
		requirePermissionMiddleware('view'),
		vValidator('param', IntegrationParamsSchema, onValidationError),
		vValidator('query', IntegrationReportQuerySchema, onValidationError),
		async (c) => {
			const { provider } = c.req.valid('param')
			const missing = await requireConfigured(c, provider)
			if (missing) {
				return missing
			}
			const query = c.req.valid('query')
			const filter = await listTenantScope(c, query.tenant, query.tenant_group)
			if (filter instanceof Response) {
				return filter
			}
			const unfiltered =
				scopeTenantId(requestUser(c)) === null &&
				query.tenant === undefined &&
				query.tenant_group === undefined
			return c.json(await buildReport(provider, filter, unfiltered))
		},
	)
	.get(
		'/:provider/board',
		requirePermissionMiddleware('view'),
		vValidator('param', IntegrationParamsSchema, onValidationError),
		vValidator('query', LinkBoardQuerySchema, onValidationError),
		async (c) => {
			const { provider } = c.req.valid('param')
			const missing = await requireConfigured(c, provider)
			if (missing) {
				return missing
			}
			const query = c.req.valid('query')
			if (query.entity_type === 'tenant') {
				// Lists every external company: global users only.
				if (scopeTenantId(requestUser(c)) !== null) {
					return sendResult(
						c,
						Result.err(
							new ForbiddenError(
								'Forbidden: tenant-scoped users cannot list external tenants',
							),
						),
					)
				}
				return c.json(await tenantBoard(provider))
			}
			const tenantId = query.tenant ?? scopeTenantId(requestUser(c))
			if (tenantId === null) {
				return jsonError(c, 'tenant is required for the device board', 400)
			}
			const tenant = (
				await getDb().select().from(tenants).where(eq(tenants.id, tenantId)).limit(1)
			)[0]
			if (!tenant) {
				return sendResult(c, Result.err(new NotFoundError('Tenant not found')))
			}
			const denied = checkTenant(c, tenantId)
			if (denied) {
				return denied
			}
			return c.json(await deviceBoard(provider, tenantId))
		},
	)
	.get(
		'/:provider/tenant-status/:id',
		requirePermissionMiddleware('view'),
		vValidator('param', IntegrationEntityParamsSchema, onValidationError),
		async (c) => {
			const { provider, id } = c.req.valid('param')
			const missing = await requireConfigured(c, provider)
			if (missing) {
				return missing
			}
			const tenant = (
				await getDb().select().from(tenants).where(eq(tenants.id, id)).limit(1)
			)[0]
			if (!tenant) {
				return sendResult(c, Result.err(new NotFoundError('Tenant not found')))
			}
			const denied = checkTenant(c, id)
			if (denied) {
				return denied
			}
			return c.json(await tenantStatus(provider, id))
		},
	)
	.get(
		'/:provider/device-status/:id',
		requirePermissionMiddleware('view'),
		vValidator('param', IntegrationEntityParamsSchema, onValidationError),
		async (c) => {
			const { provider, id } = c.req.valid('param')
			const missing = await requireConfigured(c, provider)
			if (missing) {
				return missing
			}
			const tenant = await deviceTenant(id)
			if (tenant === undefined) {
				return sendResult(c, Result.err(new NotFoundError('Device not found')))
			}
			const denied = checkTenant(c, tenant)
			if (denied) {
				return denied
			}
			return c.json(await deviceStatus(provider, id, tenant))
		},
	)
	.put(
		'/:provider/links',
		vValidator('param', IntegrationParamsSchema, onValidationError),
		vValidator('json', ExternalLinkCreateSchema, onValidationError),
		async (c) => {
			const { provider } = c.req.valid('param')
			const input = c.req.valid('json')
			const userId = requestUser(c).id
			if (input.entity_type === 'tenant') {
				const denied = requireGlobalPermission(c, 'integrations.manage')
				if (denied) {
					return denied
				}
				const tenant = (
					await getDb()
						.select()
						.from(tenants)
						.where(eq(tenants.id, input.entity_id))
						.limit(1)
				)[0]
				if (!tenant) {
					return sendResult(c, Result.err(new NotFoundError('Tenant not found')))
				}
				const external = await readTenant(provider, input.external_id)
				if (!external) {
					return sendResult(c, Result.err(new NotFoundError('External tenant not found')))
				}
				const res = await setLink(
					provider,
					{ ...input, external_tenant_id: external.external_id },
					'manual',
					userId,
				)
				return sendResult(c, res.map(linkJson))
			}
			const denied = requirePermission(c, 'integrations.manage')
			if (denied) {
				return denied
			}
			const tenant = await deviceTenant(input.entity_id)
			if (tenant === undefined) {
				return sendResult(c, Result.err(new NotFoundError('Device not found')))
			}
			const scopeDenied = checkTenant(c, tenant)
			if (scopeDenied) {
				return scopeDenied
			}
			const external = await readDevice(provider, input.external_id)
			if (!external) {
				return sendResult(c, Result.err(new NotFoundError('External device not found')))
			}
			const externalDenied = await checkExternalDeviceWrite(
				c,
				provider,
				external.external_tenant_id,
			)
			if (externalDenied) {
				return externalDenied
			}
			const res = await setLink(
				provider,
				{ ...input, external_tenant_id: external.external_tenant_id },
				'manual',
				userId,
			)
			return sendResult(c, res.map(linkJson))
		},
	)
	.put(
		'/:provider/links/ignore',
		vValidator('param', IntegrationParamsSchema, onValidationError),
		vValidator('json', ExternalIgnoreSchema, onValidationError),
		async (c) => {
			const { provider } = c.req.valid('param')
			const input = c.req.valid('json')
			const userId = requestUser(c).id
			if (input.entity_type === 'tenant') {
				const denied = requireGlobalPermission(c, 'integrations.manage')
				if (denied) {
					return denied
				}
				const external = await readTenant(provider, input.external_id)
				if (!external) {
					return sendResult(c, Result.err(new NotFoundError('External tenant not found')))
				}
				const res = await ignoreExternal(
					provider,
					'tenant',
					external.external_id,
					external.external_id,
					userId,
				)
				return sendResult(c, res.map(linkJson))
			}
			const denied = requirePermission(c, 'integrations.manage')
			if (denied) {
				return denied
			}
			const external = await readDevice(provider, input.external_id)
			if (!external) {
				return sendResult(c, Result.err(new NotFoundError('External device not found')))
			}
			const externalDenied = await checkExternalDeviceWrite(
				c,
				provider,
				external.external_tenant_id,
			)
			if (externalDenied) {
				return externalDenied
			}
			const res = await ignoreExternal(
				provider,
				'device',
				external.external_id,
				external.external_tenant_id,
				userId,
			)
			return sendResult(c, res.map(linkJson))
		},
	)
	.delete(
		'/:provider/links/:id',
		vValidator('param', IntegrationEntityParamsSchema, onValidationError),
		async (c) => {
			const { provider, id } = c.req.valid('param')
			const link = await getLink(provider, id)
			if (Result.isError(link)) {
				return sendResult(c, link)
			}
			const row = link.value
			if (row.entity_type === 'tenant') {
				const denied = requireGlobalPermission(c, 'integrations.manage')
				if (denied) {
					return denied
				}
			} else {
				const denied = requirePermission(c, 'integrations.manage')
				if (denied) {
					return denied
				}
				if (row.entity_id !== null) {
					const tenant = await deviceTenant(row.entity_id)
					const scopeDenied = checkTenant(c, tenant ?? null)
					if (scopeDenied) {
						return scopeDenied
					}
				} else {
					const externalDenied = await checkExternalDeviceWrite(
						c,
						provider,
						row.external_tenant_id,
					)
					if (externalDenied) {
						return externalDenied
					}
				}
			}
			return sendResult(c, (await deleteLink(provider, id)).map(linkJson))
		},
	)
