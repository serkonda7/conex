/**
 * Creates conex employees from external employees of the company linked to a
 * tenant and links each pair, so the report no longer lists them as missing.
 * External employees that already have a link row (linked or ignored) are
 * rejected, as are ones not assigned to the tenant's company.
 */
import { Result } from 'better-result'
import {
	EmployeeCreateSchema,
	type ExternalEmployeeImport,
	type IntegrationProvider as ProviderId,
} from 'shared/src/schemas'
import * as v from 'valibot'
import { createEmployee } from '../db/employees'
import { DuplicateError, NotFoundError, ValidationError } from '../db/errors'
import { linkOf, listLinks, setLink } from './links'
import { readEmployee } from './snapshot'
import type { ExternalEmployee } from './types'

/**
 * conex create body of an external employee. Values that do not fit the
 * conex contract (e.g. a malformed email) are dropped instead of failing.
 */
function createInput(
	external: ExternalEmployee,
	tenantId: number,
): Result<v.InferOutput<typeof EmployeeCreateSchema>, Error> {
	const input = {
		first_name: external.first_name?.slice(0, 100),
		last_name: external.last_name.slice(0, 100),
		salutation: external.salutation,
		tenant_id: tenantId,
		title: external.title?.slice(0, 200),
		email: external.email ?? undefined,
		phone: external.phone?.slice(0, 200),
		mobile: external.mobile?.slice(0, 200),
		active: external.active,
	}
	for (const candidate of [input, { ...input, email: undefined }]) {
		const parsed = v.safeParse(EmployeeCreateSchema, candidate)
		if (parsed.success) {
			return Result.ok(parsed.output)
		}
	}
	return Result.err(new ValidationError(`${external.name} cannot be imported`))
}

export async function importExternalEmployees(
	provider: ProviderId,
	input: ExternalEmployeeImport,
	userId: number,
): Promise<Result<{ created: number }, Error>> {
	const company = await linkOf(provider, 'tenant', input.tenant_id)
	if (!company) {
		return Result.err(new ValidationError('The tenant is not linked yet'))
	}
	const taken = new Set((await listLinks(provider, 'employee')).map((l) => l.external_id))
	const externals: ExternalEmployee[] = []
	for (const id of new Set(input.external_ids)) {
		const external = await readEmployee(provider, id)
		if (!external?.external_tenant_ids.includes(company.external_id)) {
			return Result.err(new NotFoundError(`External employee ${id} not found`))
		}
		if (taken.has(id)) {
			return Result.err(new DuplicateError(`${external.name} is already linked or ignored`))
		}
		externals.push(external)
	}
	let created = 0
	for (const external of externals) {
		const body = createInput(external, input.tenant_id)
		if (Result.isError(body)) {
			return body
		}
		const employee = await createEmployee(body.value)
		if (Result.isError(employee)) {
			return employee
		}
		const link = await setLink(
			provider,
			{
				entity_type: 'employee',
				entity_id: employee.value.id,
				external_id: external.external_id,
				external_tenant_id: company.external_id,
			},
			'manual',
			userId,
		)
		if (Result.isError(link)) {
			return link
		}
		created++
	}
	return Result.ok({ created })
}
