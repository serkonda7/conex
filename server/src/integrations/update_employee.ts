/**
 * Overwrites one field of a linked external employee with the conex value
 * (resolves an `employee_mismatch` finding from the conex side). The value
 * is the one the report shows: for mail addresses and phone numbers the
 * primary conex entry of that kind. The snapshot row is patched, so the
 * finding disappears without a sync.
 */
import { Result } from 'better-result'
import { eq } from 'drizzle-orm'
import type {
	EmployeePushField,
	ExternalEmployeeJson,
	IntegrationProvider as ProviderId,
} from 'shared/src/schemas'
import { NotFoundError, ValidationError } from '../db/errors'
import { employees } from '../schema'
import { nowSeconds } from '../util/time'
import { linkOf } from './links'
import { compareEmployeeFields, localEmployees } from './report'
import { mergeEmployees, readEmployee } from './snapshot'
import { enabledProviderMethod } from './store'

export async function updateExternalEmployee(
	provider: ProviderId,
	employeeId: number,
	field: EmployeePushField,
): Promise<Result<ExternalEmployeeJson, Error>> {
	const [employee] = await localEmployees(eq(employees.id, employeeId))
	if (!employee) {
		return Result.err(new NotFoundError('Employee not found'))
	}
	const link = await linkOf(provider, 'employee', employee.id)
	if (!link) {
		return Result.err(new ValidationError('Employee is not linked'))
	}
	const external = await readEmployee(provider, link.external_id)
	if (!external) {
		return Result.err(new NotFoundError('External employee not found'))
	}
	const value = compareEmployeeFields(employee, external).find((c) => c.field === field)?.local
	if (value == null) {
		return Result.err(new ValidationError(`Employee has no ${field}`))
	}
	const updateEmployee = await enabledProviderMethod(
		provider,
		'updateEmployee',
		'updating employees',
	)
	if (Result.isError(updateEmployee)) {
		return updateEmployee
	}
	const updated = await updateEmployee.value(link.external_id, { [field]: value })
	if (Result.isError(updated)) {
		return updated
	}
	const patched: ExternalEmployeeJson = { ...external, [field]: value }
	patched.name = [patched.first_name, patched.last_name].filter((p) => p !== null).join(' ')
	await mergeEmployees(provider, [patched], nowSeconds())
	return Result.ok(patched)
}

/** Deactivates an external employee and updates the snapshot after TANSS accepts it. */
export async function deactivateExternalEmployee(
	provider: ProviderId,
	externalId: string,
): Promise<Result<ExternalEmployeeJson, Error>> {
	const external = await readEmployee(provider, externalId)
	if (!external) {
		return Result.err(new NotFoundError('External employee not found'))
	}
	const updateEmployee = await enabledProviderMethod(
		provider,
		'updateEmployee',
		'updating employees',
	)
	if (Result.isError(updateEmployee)) {
		return updateEmployee
	}
	if (!external.active) {
		return Result.ok(external)
	}
	const updated = await updateEmployee.value(externalId, { active: false })
	if (Result.isError(updated)) {
		return updated
	}
	const patched: ExternalEmployeeJson = { ...external, active: false }
	await mergeEmployees(provider, [patched], nowSeconds())
	return Result.ok(patched)
}
