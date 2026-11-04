import { createEffect, type JSX, on, Show } from 'solid-js'
import { type EmployeeRow, fetch_all_employees } from '../../api/employees'
import type { RoleJson } from '../../api/roles'
import { fetch_tenants, type TenantRow } from '../../api/tenancy'
import {
	Field,
	type FormOption,
	ReadOnlyField,
	row_options,
	SelectField,
} from '../../components/form'
import { t } from '../../i18n'
import { createRows, type ErrorSink, type QueryResource } from '../../lib/resource'
import { parseId } from '../../lib/router'
import { managesUsers } from './role_hint'

/** Employees and tenants the account fields pick from. */
export interface AccountData {
	employees: QueryResource<EmployeeRow[]>
	tenants: QueryResource<TenantRow[]>
}

export function useAccountData(onError: ErrorSink): AccountData {
	const [employees] = createRows(() => fetch_all_employees(), onError)
	const [tenants] = createRows(fetch_tenants, onError)
	return { employees, tenants }
}

/** Login of an employee's account: its primary mail address (as the server stores it). */
export function loginOf(employee: EmployeeRow | undefined): string | null {
	const address = employee?.emails[0]?.address
	return address ? address.trim().toLowerCase() : null
}

export function employeeOf(data: AccountData, employeeId: string): EmployeeRow | undefined {
	return data.employees()?.find((row) => row.id === parseId(employeeId))
}

/**
 * Employee picker of an account. Employees with another account are left
 * out (`ownLogin`: the edited account's username keeps its employee); each
 * option shows the address the account would sign in with. Picking another
 * employee moves the scope to its primary tenant (least access) unless the
 * current one still fits.
 */
export function EmployeeField(props: {
	idPrefix: string
	data: AccountData
	employeeId: string
	onEmployeeChange: (value: string) => void
	tenantId: string
	onTenantChange: (value: string) => void
	ownLogin?: string
	/** Treat the initial `employeeId` as picked (scope default). */
	applyPreselection?: boolean
}): JSX.Element {
	const options = (): FormOption[] => {
		const free = (props.data.employees() ?? []).filter(
			(row) => row.login === null || row.login === props.ownLogin,
		)
		const byValue = new Map(free.map((row) => [String(row.id), row]))
		return row_options(free).map((option) => ({
			...option,
			detail: loginOf(byValue.get(String(option.value))) ?? t('user.noMail'),
		}))
	}

	function handleEmployee(value: string): void {
		const next = employeeOf(props.data, value)
		props.onEmployeeChange(value)
		const scope = parseId(props.tenantId)
		if (!next) {
			props.onTenantChange('')
		} else if (scope === null || !next.tenant_ids.includes(scope)) {
			props.onTenantChange(String(next.tenant_ids[0] ?? ''))
		}
	}

	if (props.applyPreselection === true) {
		createEffect(
			on(props.data.employees, (rows) => {
				if (rows && props.employeeId !== '') {
					handleEmployee(props.employeeId)
				}
			}),
		)
	}

	return (
		<SelectField
			id={`${props.idPrefix}-employee`}
			label={t('user.employee')}
			value={props.employeeId}
			onChange={handleEmployee}
			options={options()}
			emptyLabel={t('user.noEmployee')}
			disabled={props.data.employees.loading}
		/>
	)
}

/**
 * Username of an account with employee: its primary mail address, read
 * only. Without a mail address the employee cannot get an account; the
 * hint links to its edit form. Accounts without employee show `children`.
 */
export function LoginField(props: {
	idPrefix: string
	employee: EmployeeRow | undefined
	children?: JSX.Element
}): JSX.Element {
	return (
		<Show when={props.employee} fallback={props.children}>
			{(employee: () => EmployeeRow) => (
				<Show
					when={loginOf(employee())}
					fallback={
						<Field label={t('auth.username')}>
							<p class="field-hint field-hint-error" role="status">
								{t('user.employeeNoMail')}{' '}
								<a href={`/employees/${employee().id}/edit`}>{t('user.addMail')}</a>
							</p>
						</Field>
					}
				>
					{(login: () => string) => (
						<ReadOnlyField
							id={`${props.idPrefix}-username`}
							label={t('auth.username')}
							value={login()}
						/>
					)}
				</Show>
			)}
		</Show>
	)
}

/** Tenant scope: one of the employee's tenants; user managers and accounts without employee are global. */
export function ScopeField(props: {
	idPrefix: string
	data: AccountData
	role: RoleJson | undefined
	employee: EmployeeRow | undefined
	tenantId: string
	onTenantChange: (value: string) => void
}): JSX.Element {
	/** Tenants of the selected employee, in membership order. */
	const scopeOptions = (): FormOption[] =>
		row_options(
			(props.employee?.tenant_ids ?? []).flatMap((id) => {
				const row = props.data.tenants()?.find((r) => r.id === id)
				return row ? [row] : []
			}),
		)
	return (
		<Show when={!managesUsers(props.role) && props.employee}>
			<SelectField
				id={`${props.idPrefix}-tenant`}
				label={t('user.tenantScope')}
				value={props.tenantId}
				onChange={props.onTenantChange}
				options={scopeOptions()}
				emptyLabel={t('common.allTenants')}
			/>
		</Show>
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
