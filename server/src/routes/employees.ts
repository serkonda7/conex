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
const TENANTS_PERMISSION = 'Forbidden: employees.tenants permission required to change tenants'

/** Same tenants in the same order. */
function sameTenants(a: readonly number[], b: readonly number[]): boolean {
	return a.length === b.length && a.every((id, i) => id === b[i])
}

/** Every one of `ids` lies in `scope` (`undefined` = global). */
function allInScope(ids: readonly number[], scope: readonly number[] | undefined): boolean {
	return scope === undefined || ids.every((id) => scope.includes(id))
}

/**
 * Membership change gate: tenants of an employee also scope its account,
 * so changing them needs `employees.tenants`. Scoped requesters may only
 * add or remove their own tenants; the others stay as they are, in order.
 */
function checkTenantChange(
	c: Context,
	current: readonly number[],
	next: readonly number[],
): Response | null {
	if (sameTenants(current, next)) {
		return null
	}
	if (!can(requestUser(c), 'employees.tenants')) {
		return forbidden(c, TENANTS_PERMISSION)
	}
	const scope = requestScope(c)
	if (scope === undefined) {
		return null
	}
	const outside = (ids: readonly number[]): number[] => ids.filter((id) => !scope.includes(id))
	return sameTenants(outside(current), outside(next)) ? null : forbidden(c, OTHER_TENANTS)
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
 * one of the requester's tenants grants access. Scoped requesters create
 * employees in their own tenants only and cannot delete employees that
 * other tenants share. Changing the tenants of an existing employee needs
 * `employees.tenants` (see `checkTenantChange`).
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
			if (!allInScope(body.tenant_ids, requestScope(c))) {
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
			const denied =
				body.tenant_ids === undefined
					? null
					: checkTenantChange(c, current.tenant_ids, body.tenant_ids)
			if (denied) {
				return denied
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
			if (!allInScope(current.tenant_ids, requestScope(c))) {
				return forbidden(c, OTHER_TENANTS)
			}
			return sendResult(c, await deleteEmployee(id))
		},
	)
