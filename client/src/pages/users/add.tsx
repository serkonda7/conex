import { createSignal, type JSX } from 'solid-js'
import type { EmployeeRow } from '../../api/employees'
import { fetch_roles, type RoleJson } from '../../api/roles'
import { create_user } from '../../api/users'
import { FormPage, row_options, SelectField, TextField } from '../../components/form'
import { t } from '../../i18n'
import { type FormValues, is_add_another_submit, submit_form, useFormState } from '../../lib/form'
import { createRows } from '../../lib/resource'
import { parseId, queryParam } from '../../lib/router'
import { AccountFields, scopeToSave, suggestedUsername } from './account_fields'
import { RoleHint } from './role_hint'

/**
 * /users/add?employee= — account create form (`users.manage`). Opened from
 * an employee page, the employee is preselected and the form returns there.
 */
export function UserAddPage(): JSX.Element {
	const form = useFormState()
	const fromEmployee = parseId(queryParam('employee'))
	const [username, setUsername] = createSignal('')
	const [password, setPassword] = createSignal('')
	const [roleId, setRoleId] = createSignal('')
	const [employeeId, setEmployeeId] = createSignal(
		fromEmployee === null ? '' : String(fromEmployee),
	)
	const [tenantId, setTenantId] = createSignal('')
	const [roles] = createRows(fetch_roles, form.setError)
	const role = (): RoleJson | undefined => roles()?.find((r) => r.id === parseId(roleId()))
	/** Username last filled in from an employee; replaced while untouched. */
	let suggested = ''

	function handleEmployee(value: string, employee: EmployeeRow | undefined): void {
		setEmployeeId(value)
		if (username() === suggested) {
			suggested = suggestedUsername(employee)
			setUsername(suggested)
		}
	}

	function validate(): string | null {
		if (!password()) {
			return t('auth.passwordRequired')
		}
		return parseId(roleId()) === null ? t('user.selectRole') : null
	}

	async function handleCreate(e: SubmitEvent): Promise<void> {
		e.preventDefault()
		await submit_form({
			form,
			name: username(),
			nameError: t('auth.usernameRequired'),
			validate,
			save: (values: FormValues) =>
				create_user({
					username: values.name,
					password: password(),
					role_id: parseId(roleId()) ?? 0,
					employee_id: parseId(employeeId()),
					tenant_id: scopeToSave(role(), employeeId(), tenantId()),
				}),
			navigateTo: fromEmployee === null ? '/users' : `/employees/${fromEmployee}`,
			onSuccess: is_add_another_submit(e)
				? () => {
						setUsername('')
						setEmployeeId('')
						setTenantId('')
						suggested = ''
					}
				: undefined,
		})
	}

	return (
		<FormPage
			form={form}
			title={t('user.addTitle')}
			cancelTo={fromEmployee === null ? '/users' : `/employees/${fromEmployee}`}
			onSubmit={handleCreate}
		>
			<AccountFields
				idPrefix="user"
				role={role()}
				employeeId={employeeId()}
				onEmployeeChange={handleEmployee}
				tenantId={tenantId()}
				onTenantChange={setTenantId}
				onError={form.setError}
				applyPreselection
			/>
			<TextField
				id="user-username"
				label={t('auth.username')}
				required
				placeholder={t('user.usernamePlaceholder')}
				maxLength={254}
				autocomplete="off"
				value={username()}
				onInput={setUsername}
			/>
			<TextField
				id="user-password"
				label={t('auth.password')}
				required
				type="password"
				placeholder={t('user.temporaryPassword')}
				autocomplete="new-password"
				value={password()}
				onInput={setPassword}
			/>
			<SelectField
				id="user-role"
				label={t('entity.role.one')}
				required
				value={roleId()}
				onChange={setRoleId}
				options={row_options(roles() ?? [])}
				hint={<RoleHint role={role()} />}
			/>
		</FormPage>
	)
}
