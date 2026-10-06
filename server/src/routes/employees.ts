import {
	EmployeeCreateSchema,
	EmployeeListQuerySchema,
	EmployeeUpdateSchema,
	EntityParamsSchema,
} from 'shared/src/schemas'
import {
	createEmployee,
	deleteEmployee,
	getEmployee,
	listEmployees,
	updateEmployee,
} from '../db/employees'
import { makeTenantApp } from './crud'

export const employeesApp = makeTenantApp({
	listQuerySchema: EmployeeListQuerySchema,
	createSchema: EmployeeCreateSchema,
	updateSchema: EmployeeUpdateSchema,
	paramSchema: EntityParamsSchema,
	list: listEmployees,
	create: createEmployee,
	get: getEmployee,
	update: updateEmployee,
	remove: deleteEmployee,
	filters: (q: { active?: 'true' | 'false' }) => ({
		active: q.active === undefined ? undefined : q.active === 'true',
	}),
})
