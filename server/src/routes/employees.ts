import { vValidator } from '@hono/valibot-validator'
import { Result } from 'better-result'
import { type Context, Hono } from 'hono'
import {
	DeleteQuerySchema,
	EmployeeCreateSchema,
	EmployeeListQuerySchema,
	EmployeeUpdateSchema,
	EntityParamsSchema,
} from 'shared/src/schemas'
import { can, checkTenants, forbidden, listTenantScope, requestScope, requestUser } from '../authz'
import {
	createEmployee,
	deleteEmployee,
	type EmployeeRow,
	getEmployee,
	listEmployees,
	updateEmployee,
} from '../db/employees'
import { authMiddleware } from '../middleware/auth'
import { requirePermissionMiddleware } from '../middleware/permissions'
import { onValidationError } from '../middleware/validation'
import { sendCreated, sendResult } from '../util/result_response'

const OTHER_TENANTS = 'Forbidden: the employee also belongs to tenants outside your scope'

/** Same tenants in the same order. */
function sameTenants(a: readonly number[], b: readonly number[]): boolean {
	return a.length === b.length && a.every((id, i) => id === b[i])
}

/** Loads an employee the requester may access: 404 when missing, 403 when out of scope. */
async function loadEmployee(c: Context, id: number): Promise<EmployeeRow | Response> {
	const current = await getEmployee(id)
	if (Result.isError(current)) {
		return sendResult(c, current)
	}
	return checkTenants(c, current.value.tenant_ids) ?? current.value
}

/**
 * Employees belong to one or more tenants (`tenant_ids`); a membership in
 * the requester's tenant grants access. Scoped requesters create employees
 * in their own tenant only and cannot change memberships or delete
 * employees that other tenants share.
 */
export const employeesApp = new Hono()
	.use(authMiddleware)
	.use(requirePermissionMiddleware('view'))
	.get('/', vValidator('query', EmployeeListQuerySchema, onValidationError), async (c) => {
		const query = c.req.valid('query')
		const scope = await listTenantScope(c, query.tenant, query.tenant_group)
		if (scope instanceof Response) {
			return scope
		}
		return c.json(
			await listEmployees({
				search: query.search,
				page: query.page,
				limit: query.limit,
				sort: query.sort,
				order: query.order,
				active: query.active === undefined ? undefined : query.active === 'true',
				...scope,
			}),
		)
	})
	.post(
		'/',
		requirePermissionMiddleware('edit'),
		vValidator('json', EmployeeCreateSchema, onValidationError),
		async (c) => {
			const body = c.req.valid('json')
			const scope = requestScope(c)
			if (scope !== undefined && !sameTenants(body.tenant_ids, [scope])) {
				return forbidden(c)
			}
			return sendCreated(c, await createEmployee(body))
		},
	)
	.get('/:id', vValidator('param', EntityParamsSchema, onValidationError), async (c) => {
		const current = await loadEmployee(c, c.req.valid('param').id)
		return current instanceof Response ? current : c.json(current)
	})
	.patch(
		'/:id',
		requirePermissionMiddleware('edit'),
		vValidator('param', EntityParamsSchema, onValidationError),
		vValidator('json', EmployeeUpdateSchema, onValidationError),
		async (c) => {
			const { id } = c.req.valid('param')
			const body = c.req.valid('json')
			const current = await loadEmployee(c, id)
			if (current instanceof Response) {
				return current
			}
			if (
				requestScope(c) !== undefined &&
				body.tenant_ids !== undefined &&
				!sameTenants(body.tenant_ids, current.tenant_ids)
			) {
				return forbidden(c)
			}
			return sendResult(
				c,
				await updateEmployee(id, body, {
					mayChangeLogin: can(requestUser(c), 'users.manage'),
				}),
			)
		},
	)
	.delete(
		'/:id',
		requirePermissionMiddleware('delete'),
		vValidator('param', EntityParamsSchema, onValidationError),
		vValidator('query', DeleteQuerySchema, onValidationError),
		async (c) => {
			const { id } = c.req.valid('param')
			const current = await loadEmployee(c, id)
			if (current instanceof Response) {
				return current
			}
			const scope = requestScope(c)
			if (scope !== undefined && !sameTenants(current.tenant_ids, [scope])) {
				return forbidden(c, OTHER_TENANTS)
			}
			return sendResult(c, await deleteEmployee(id))
		},
	)
