import { createEffect, type JSX, on, Show } from 'solid-js'
import { type EmployeeRow, fetch_all_employees } from '../../api/employees'
import type { RoleJson } from '../../api/roles'
import { fetch_tenants } from '../../api/tenancy'
import { type FormOption, Hint, row_options, SelectField } from '../../components/form'
import { t } from '../../i18n'
import { createRows, type ErrorSink } from '../../lib/resource'
import { parseId } from '../../lib/router'
import { managesUsers } from './role_hint'

/**
 * Employee and tenant scope of an account. A scope needs an employee and is
 * one of its tenants; picking another employee moves the scope to its
 * primary tenant (least access) unless the current one still fits.
 */
export function AccountFields(props: {
	idPrefix: string
	role: RoleJson | undefined
	employeeId: string
	onEmployeeChange: (value: string, employee: EmployeeRow | undefined) => void
	tenantId: string
	onTenantChange: (value: string) => void
	onError: ErrorSink
	/** Treat the initial `employeeId` as picked (scope and username defaults). */
	applyPreselection?: boolean
}): JSX.Element {
	const [employees] = createRows(() => fetch_all_employees(), props.onError)
	const [tenants] = createRows(fetch_tenants, props.onError)
	const employee = (): EmployeeRow | undefined =>
		employees()?.find((row) => row.id === parseId(props.employeeId))
	/** Tenants of the selected employee, in membership order. */
	const scopeOptions = (): FormOption[] =>
		row_options(
			(employee()?.tenant_ids ?? []).flatMap((id) => {
				const row = tenants()?.find((r) => r.id === id)
				return row ? [row] : []
			}),
		)

	function handleEmployee(value: string): void {
		const next = employees()?.find((row) => row.id === parseId(value))
		props.onEmployeeChange(value, next)
		const scope = parseId(props.tenantId)
		if (!next) {
			props.onTenantChange('')
		} else if (scope === null || !next.tenant_ids.includes(scope)) {
			props.onTenantChange(String(next.tenant_ids[0] ?? ''))
		}
	}

	if (props.applyPreselection === true) {
		createEffect(
			on(employees, (rows) => {
				if (rows && props.employeeId !== '') {
					handleEmployee(props.employeeId)
				}
			}),
		)
	}

	return (
		<>
			<SelectField
				id={`${props.idPrefix}-employee`}
				label={t('user.employee')}
				value={props.employeeId}
				onChange={handleEmployee}
				options={row_options(employees() ?? [])}
				emptyLabel={t('user.noEmployee')}
				disabled={employees.loading}
				hint={<Hint>{t('user.employeeHint')}</Hint>}
			/>
			<Show when={!managesUsers(props.role) && employee()}>
				<SelectField
					id={`${props.idPrefix}-tenant`}
					label={t('user.tenantScope')}
					value={props.tenantId}
					onChange={props.onTenantChange}
					options={scopeOptions()}
					emptyLabel={t('common.allTenants')}
					hint={<Hint>{t('user.tenantHint')}</Hint>}
				/>
			</Show>
		</>
	)
}

/** Scope to save: global for user managers and accounts without employee. */
export function scopeToSave(
	role: RoleJson | undefined,
	employeeId: string,
	tenantId: string,
): number | null {
	return managesUsers(role) || parseId(employeeId) === null ? null : parseId(tenantId)
}

/** Login suggested for an employee's account: its primary mail address. */
export function suggestedUsername(employee: EmployeeRow | undefined): string {
	return employee?.emails[0]?.address.toLowerCase() ?? ''
}
