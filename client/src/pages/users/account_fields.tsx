import { For, type JSX, Show } from 'solid-js'
import { type EmployeeRow, fetch_all_employees } from '../../api/employees'
import type { RoleJson } from '../../api/roles'
import { fetch_tenants, type TenantRow } from '../../api/tenancy'
import { ContactListField } from '../../components/contacts'
import {
	Field,
	type FormOption,
	Hint,
	ReadOnlyField,
	row_options,
	SelectField,
} from '../../components/form'
import { t, tp } from '../../i18n'
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
 * option shows the address the account would sign in with. The account
 * then gets exactly the employee's tenants.
 */
export function EmployeeField(props: {
	idPrefix: string
	data: AccountData
	employeeId: string
	onEmployeeChange: (value: string) => void
	ownLogin?: string
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

	return (
		<SelectField
			id={`${props.idPrefix}-employee`}
			label={t('user.employee')}
			value={props.employeeId}
			onChange={props.onEmployeeChange}
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

/** One row of the tenant list; `id` is the select value ('' = none chosen). */
export interface TenantEntry {
	id: string
}

const blankTenant = (): TenantEntry => ({ id: '' })

type SelectEvent = Event & { currentTarget: HTMLSelectElement }

/** Tenant rows of an account's own tenants, for the scope list. */
export function tenantEntries(ids: readonly number[]): TenantEntry[] {
	return ids.map((id) => ({ id: String(id) }))
}

/**
 * Tenant scope. User managers are global (no field). Accounts of employees
 * get exactly the employee's tenants (read only, changed on the employee);
 * other accounts list their own tenants, none meaning all tenants.
 */
export function ScopeField(props: {
	idPrefix: string
	data: AccountData
	role: RoleJson | undefined
	employee: EmployeeRow | undefined
	tenants: TenantEntry[]
	onTenantsChange: (rows: TenantEntry[]) => void
}): JSX.Element {
	const tenantName = (id: number): string =>
		props.data.tenants()?.find((row) => row.id === id)?.name ?? `#${id}`
	return (
		<Show when={!managesUsers(props.role)}>
			<Show
				when={props.employee}
				fallback={
					<ContactListField
						id={`${props.idPrefix}-tenant`}
						label={t('user.tenantScope')}
						addLabel={t('employee.addTenant')}
						rows={props.tenants}
						onChange={props.onTenantsChange}
						blank={blankTenant}
						hint={<Hint>{t('user.tenantsHint')}</Hint>}
						row={(
							entry: () => TenantEntry,
							update: (patch: Partial<TenantEntry>) => void,
							index: number,
						): JSX.Element => (
							<select
								id={`${props.idPrefix}-tenant-${index}`}
								aria-label={tp('entity.tenant', 1)}
								value={entry().id}
								onChange={(e: SelectEvent) => update({ id: e.currentTarget.value })}
							>
								<option value="">{t('common.selectPlaceholder')}</option>
								<For each={row_options(props.data.tenants() ?? [])}>
									{(o: FormOption): JSX.Element => (
										<option value={o.value}>{o.label}</option>
									)}
								</For>
							</select>
						)}
					/>
				}
			>
				{(employee: () => EmployeeRow) => (
					<ReadOnlyField
						id={`${props.idPrefix}-tenant`}
						label={t('user.tenantScope')}
						value={employee().tenant_ids.map(tenantName).join(', ')}
						hint={t('user.scopeFollowsEmployee')}
					/>
				)}
			</Show>
		</Show>
	)
}

/** Own tenants to save: none for user managers and accounts of employees. */
export function scopeToSave(
	role: RoleJson | undefined,
	employeeId: string,
	tenants: readonly TenantEntry[],
): number[] {
	if (managesUsers(role) || parseId(employeeId) !== null) {
		return []
	}
	return [
		...new Set(tenants.map((row) => parseId(row.id)).filter((id): id is number => id !== null)),
	]
}

/** Validation of the role/employee pair: user managers stay global, so no employee. */
export function scopeError(role: RoleJson | undefined, employeeId: string): string | null {
	return managesUsers(role) && parseId(employeeId) !== null ? t('user.managerNoEmployee') : null
}
