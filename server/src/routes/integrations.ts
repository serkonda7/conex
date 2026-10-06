import { vValidator } from '@hono/valibot-validator'
import { Result } from 'better-result'
import { eq } from 'drizzle-orm'
import { type Context, Hono } from 'hono'
import {
	ExternalDeviceCreateSchema,
	ExternalDeviceUpdateSchema,
	ExternalEmployeeImportSchema,
	ExternalIgnoreLocalSchema,
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
	TicketListQuerySchema,
} from 'shared/src/schemas'
import {
	checkListTenantParam,
	checkTenant,
	forbidden,
	listTenantScope,
	requestScope,
	requestUser,
	requireGlobalPermission,
	requireGlobalScope,
	requirePermission,
} from '../authz'
import { exists } from '../db/list'
import { deviceTenant, employeeTenant } from '../db/owners'
import { deviceBoard, employeeBoard, tenantBoard } from '../integrations/board'
import { createExternalDevice } from '../integrations/create_device'
import { importExternalEmployees } from '../integrations/import_employees'
import {
	deleteLink,
	getLink,
	ignoreExternal,
	ignoreLocal,
	linkJson,
	linkOf,
	listLinks,
	setLink,
} from '../integrations/links'
import { buildReport, deviceStatus, employeeStatus, tenantStatus } from '../integrations/report'
import { readDevice, readEmployee, readTenant, readTenants } from '../integrations/snapshot'
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
import { createTicket, listTickets } from '../integrations/tickets'
import { updateExternalDevice } from '../integrations/update_device'
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

const EXTERNAL_TENANTS_GLOBAL = 'Forbidden: tenant-scoped users cannot list external tenants'

function notFound(c: Context, message: string): Response {
	return jsonError(c, message, 404)
}

/** Read gate for a tenant by id: 404 when missing, 403 when out of scope, else null. */
async function checkTenantRow(c: Context, tenantId: number): Promise<Response | null> {
	if (!(await exists(tenants, eq(tenants.id, tenantId)))) {
		return notFound(c, 'Tenant not found')
	}
	return checkTenant(c, tenantId)
}

/** Tenant of a device in the requester's scope, or the 404/403 response. */
async function loadDeviceTenant(c: Context, deviceId: number): Promise<number | null | Response> {
	const tenant = await deviceTenant(deviceId)
	if (tenant === undefined) {
		return notFound(c, 'Device not found')
	}
	return checkTenant(c, tenant) ?? tenant
}

/** Tenant of an employee in the requester's scope, or the 404/403 response. */
async function loadEmployeeTenant(c: Context, employeeId: number): Promise<number | Response> {
	const tenant = await employeeTenant(employeeId)
	if (tenant === undefined) {
		return notFound(c, 'Employee not found')
	}
	return checkTenant(c, tenant) ?? tenant
}

/**
 * Write gate for an external device or employee (an ignored one has no
 * conex object to scope by): scoped editors may only touch objects of the
 * company linked to their own tenant. Employees may belong to several
 * companies; any of them counts.
 */
async function checkExternalWrite(
	c: Context,
	provider: ProviderId,
	externalTenantIds: string | null | string[],
): Promise<Response | null> {
	const scope = requestScope(c)
	if (scope === undefined) {
		return null
	}
	const own = await linkOf(provider, 'tenant', scope)
	const ids = Array.isArray(externalTenantIds) ? externalTenantIds : [externalTenantIds]
	if (!own || !ids.includes(own.external_id)) {
		return forbidden(c)
	}
	return null
}

/** Company an employee link is filed under: the tenant's, when assigned to it. */
async function employeeCompany(
	provider: ProviderId,
	tenantId: number,
	externalTenantIds: string[],
	fallback: string | null,
): Promise<string | null> {
	const company = await linkOf(provider, 'tenant', tenantId)
	return company && externalTenantIds.includes(company.external_id)
		? company.external_id
		: fallback
}

/**
 * Integrations: `integrations.manage` configures and lists providers
 * (credentials verified before saving, secrets never returned), runs syncs
 * and edits links; the reports and boards only need `view`. Links of
 * tenants are global-write like tenants themselves; device and employee
 * links follow the object's tenant scope.
 * External company lists are global-only: scoped users must not see other
 * customers. `tickets.create` opens tickets for tenants in scope and lists
 * their open tickets.
 * `integrations.manage` may also create conex devices in the external system,
 * overwrite external device fields with conex values and (with `edit`)
 * import external employees into conex.
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
			const clean = query.clean === 'true'
			// Scoped users may only sync their own tenant.
			const scopeDenied =
				(clean ? requireGlobalPermission(c, 'integrations.manage') : null) ??
				checkListTenantParam(c, query.tenant)
			if (scopeDenied) {
				return scopeDenied
			}
			const tenant = requestScope(c) ?? query.tenant ?? null
			return sendResult(c, await startSync(c.req.valid('param').provider, tenant, clean), 202)
		},
	)
	.post(
		'/:provider/tickets',
		requirePermissionMiddleware('tickets.create'),
		vValidator('param', IntegrationParamsSchema, onValidationError),
		vValidator('json', TicketCreateSchema, onValidationError),
		async (c) => {
			const input = c.req.valid('json')
			return (
				checkTenant(c, input.tenant_id) ??
				sendCreated(c, await createTicket(c.req.valid('param').provider, input))
			)
		},
	)
	.get(
		'/:provider/tickets',
		requirePermissionMiddleware('tickets.create'),
		vValidator('param', IntegrationParamsSchema, onValidationError),
		vValidator('query', TicketListQuerySchema, onValidationError),
		async (c) => {
			const query = c.req.valid('query')
			const denied = checkListTenantParam(c, query.tenant)
			if (denied) {
				return denied
			}
			const tenant = requestScope(c) ?? query.tenant
			if (tenant === undefined) {
				return jsonError(c, 'tenant is required', 400)
			}
			return sendResult(c, await listTickets(c.req.valid('param').provider, tenant))
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
			const { provider } = c.req.valid('param')
			const denied =
				requireGlobalScope(c, EXTERNAL_TENANTS_GLOBAL) ??
				(await requireConfigured(c, provider))
			if (denied) {
				return denied
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
				.sort((a, b) => {
					const ra = rows.get(a.external_id)
					const rb = rows.get(b.external_id)
					const oa = ra?.ignored ? 2 : ra?.tenant != null ? 1 : 0
					const ob = rb?.ignored ? 2 : rb?.tenant != null ? 1 : 0
					return oa - ob || a.name.localeCompare(b.name)
				})
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
				requestScope(c) === undefined &&
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
				return (
					requireGlobalScope(c, EXTERNAL_TENANTS_GLOBAL) ??
					c.json(await tenantBoard(provider))
				)
			}
			const tenantId = query.tenant ?? requestScope(c)
			if (tenantId === undefined) {
				return jsonError(c, `tenant is required for the ${query.entity_type} board`, 400)
			}
			return (
				(await checkTenantRow(c, tenantId)) ??
				c.json(
					query.entity_type === 'employee'
						? await employeeBoard(provider, tenantId)
						: await deviceBoard(provider, tenantId),
				)
			)
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
			return (await checkTenantRow(c, id)) ?? c.json(await tenantStatus(provider, id))
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
			const tenant = await loadDeviceTenant(c, id)
			if (tenant instanceof Response) {
				return tenant
			}
			return c.json(await deviceStatus(provider, id, tenant))
		},
	)
	.get(
		'/:provider/employee-status/:id',
		requirePermissionMiddleware('view'),
		vValidator('param', IntegrationEntityParamsSchema, onValidationError),
		async (c) => {
			const { provider, id } = c.req.valid('param')
			const missing = await requireConfigured(c, provider)
			if (missing) {
				return missing
			}
			const tenant = await loadEmployeeTenant(c, id)
			if (tenant instanceof Response) {
				return tenant
			}
			return c.json(await employeeStatus(provider, id, tenant))
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
				if (!(await exists(tenants, eq(tenants.id, input.entity_id)))) {
					return notFound(c, 'Tenant not found')
				}
				const external = await readTenant(provider, input.external_id)
				if (!external) {
					return notFound(c, 'External tenant not found')
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
			if (input.entity_type === 'employee') {
				const tenant = await loadEmployeeTenant(c, input.entity_id)
				if (tenant instanceof Response) {
					return tenant
				}
				const external = await readEmployee(provider, input.external_id)
				if (!external) {
					return notFound(c, 'External employee not found')
				}
				const externalDenied = await checkExternalWrite(
					c,
					provider,
					external.external_tenant_ids,
				)
				if (externalDenied) {
					return externalDenied
				}
				const company = await employeeCompany(
					provider,
					tenant,
					external.external_tenant_ids,
					external.external_tenant_id,
				)
				const res = await setLink(
					provider,
					{ ...input, external_tenant_id: company },
					'manual',
					userId,
				)
				return sendResult(c, res.map(linkJson))
			}
			const tenant = await loadDeviceTenant(c, input.entity_id)
			if (tenant instanceof Response) {
				return tenant
			}
			const external = await readDevice(provider, input.external_id)
			if (!external) {
				return notFound(c, 'External device not found')
			}
			const externalDenied = await checkExternalWrite(
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
					return notFound(c, 'External tenant not found')
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
			if (input.entity_type === 'employee') {
				const external = await readEmployee(provider, input.external_id)
				if (!external) {
					return notFound(c, 'External employee not found')
				}
				const externalDenied = await checkExternalWrite(
					c,
					provider,
					external.external_tenant_ids,
				)
				if (externalDenied) {
					return externalDenied
				}
				// Filed under the scoped user's company, so they can restore it.
				const scope = requestScope(c)
				const company =
					scope === undefined
						? external.external_tenant_id
						: await employeeCompany(
								provider,
								scope,
								external.external_tenant_ids,
								external.external_tenant_id,
							)
				const res = await ignoreExternal(
					provider,
					'employee',
					external.external_id,
					company,
					userId,
				)
				return sendResult(c, res.map(linkJson))
			}
			const external = await readDevice(provider, input.external_id)
			if (!external) {
				return notFound(c, 'External device not found')
			}
			const externalDenied = await checkExternalWrite(
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
	.put(
		'/:provider/links/ignore-local',
		vValidator('param', IntegrationParamsSchema, onValidationError),
		vValidator('json', ExternalIgnoreLocalSchema, onValidationError),
		async (c) => {
			const { provider } = c.req.valid('param')
			const input = c.req.valid('json')
			const userId = requestUser(c).id
			const denied = requirePermission(c, 'integrations.manage')
			if (denied) {
				return denied
			}
			const tenant =
				input.entity_type === 'employee'
					? await loadEmployeeTenant(c, input.entity_id)
					: await loadDeviceTenant(c, input.entity_id)
			if (tenant instanceof Response) {
				return tenant
			}
			const tenantLink = tenant !== null ? await linkOf(provider, 'tenant', tenant) : null
			if (!tenantLink) {
				return jsonError(c, `The ${input.entity_type}'s tenant is not linked yet`, 400)
			}
			const externalDenied = await checkExternalWrite(c, provider, tenantLink.external_id)
			if (externalDenied) {
				return externalDenied
			}
			const res = await ignoreLocal(
				provider,
				input.entity_type,
				input.entity_id,
				tenantLink.external_id,
				userId,
			)
			return sendResult(c, res.map(linkJson))
		},
	)
	.post(
		'/:provider/devices',
		vValidator('param', IntegrationParamsSchema, onValidationError),
		vValidator('json', ExternalDeviceCreateSchema, onValidationError),
		async (c) => {
			const { provider } = c.req.valid('param')
			const input = c.req.valid('json')
			const denied = requirePermission(c, 'integrations.manage')
			if (denied) {
				return denied
			}
			const tenant = await loadDeviceTenant(c, input.device_id)
			if (tenant instanceof Response) {
				return tenant
			}
			const tenantLink = tenant !== null ? await linkOf(provider, 'tenant', tenant) : null
			if (!tenantLink) {
				return jsonError(c, "The device's tenant is not linked yet", 400)
			}
			const externalDenied = await checkExternalWrite(c, provider, tenantLink.external_id)
			if (externalDenied) {
				return externalDenied
			}
			return sendCreated(
				c,
				await createExternalDevice(provider, input.device_id, requestUser(c).id),
			)
		},
	)
	.put(
		'/:provider/devices',
		vValidator('param', IntegrationParamsSchema, onValidationError),
		vValidator('json', ExternalDeviceUpdateSchema, onValidationError),
		async (c) => {
			const { provider } = c.req.valid('param')
			const input = c.req.valid('json')
			const denied = requirePermission(c, 'integrations.manage')
			if (denied) {
				return denied
			}
			const tenant = await loadDeviceTenant(c, input.device_id)
			if (tenant instanceof Response) {
				return tenant
			}
			const link = await linkOf(provider, 'device', input.device_id)
			if (!link) {
				return jsonError(c, 'Device is not linked', 400)
			}
			const externalDenied = await checkExternalWrite(c, provider, link.external_tenant_id)
			if (externalDenied) {
				return externalDenied
			}
			return sendResult(c, await updateExternalDevice(provider, input.device_id, input.field))
		},
	)
	.post(
		'/:provider/employees',
		vValidator('param', IntegrationParamsSchema, onValidationError),
		vValidator('json', ExternalEmployeeImportSchema, onValidationError),
		async (c) => {
			const { provider } = c.req.valid('param')
			const input = c.req.valid('json')
			// Imports create inventory, so they need `edit` as well.
			const denied =
				requirePermission(c, 'integrations.manage') ??
				requirePermission(c, 'edit') ??
				(await checkTenantRow(c, input.tenant_id))
			if (denied) {
				return denied
			}
			return sendCreated(c, await importExternalEmployees(provider, input, requestUser(c).id))
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
					const owner =
						row.entity_type === 'employee'
							? await employeeTenant(row.entity_id)
							: await deviceTenant(row.entity_id)
					const scopeDenied = checkTenant(c, owner ?? null)
					if (scopeDenied) {
						return scopeDenied
					}
				} else {
					const externalDenied = await checkExternalWrite(
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
