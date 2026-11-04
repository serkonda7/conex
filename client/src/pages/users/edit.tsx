import { createSignal, type JSX } from 'solid-js'
import type { EmployeeRow } from '../../api/employees'
import { fetch_roles, type RoleJson } from '../../api/roles'
import { fetch_user, type UserJson, update_user } from '../../api/users'
import { FormPage, row_options, SelectField, TextField } from '../../components/form'
import { t } from '../../i18n'
import { id_value, submit_form, useEntityForm } from '../../lib/form'
import { createRows } from '../../lib/resource'
import { parseId } from '../../lib/router'
import {
	EmployeeField,
	employeeOf,
	LoginField,
	loginOf,
	ScopeField,
	scopeToSave,
	useAccountData,
} from './account_fields'
import { RoleHint } from './role_hint'

/**
 * /users/:id/edit — employee, role, tenant-scope, and password form
 * (`users.manage`). Linking an employee makes its primary mail address the
 * username.
 */
export function UserEditPage(props: { id: number }): JSX.Element {
	const [roleId, setRoleId] = createSignal('')
	const [tenantId, setTenantId] = createSignal('')
	const [employeeId, setEmployeeId] = createSignal('')
	const [password, setPassword] = createSignal('')
	const form = useEntityForm({
		id: props.id,
		load: fetch_user,
		fill: (row: UserJson) => {
			setRoleId(id_value(row.role_id))
			setTenantId(id_value(row.tenant_id))
			setEmployeeId(id_value(row.employee_id))
		},
	})
	const [roles] = createRows(fetch_roles)
	const role = (): RoleJson | undefined => roles()?.find((r) => r.id === parseId(roleId()))
	const data = useAccountData(form.setError)
	const employee = (): EmployeeRow | undefined => employeeOf(data, employeeId())

	async function handleSave(e: SubmitEvent): Promise<void> {
		e.preventDefault()
		await submit_form({
			form,
			name: '',
			optionalName: true,
			validate: () =>
				// Accounts linked before logins followed the mail address may keep theirs.
				employee() && !loginOf(employee()) && employee()?.id !== form.record()?.employee_id
					? t('user.employeeNoMail')
					: parseId(roleId()) === null
						? t('user.selectRole')
						: null,
			save: () =>
				update_user(props.id, {
					role_id: parseId(roleId()) ?? undefined,
					employee_id: parseId(employeeId()),
					tenant_id: scopeToSave(role(), employeeId(), tenantId()),
					...(password() ? { password: password() } : {}),
				}),
			navigateTo: '/users',
		})
	}

	return (
		<FormPage
			form={form}
			title={t('user.editTitle')}
			name={form.record()?.username}
			loadingText={t('user.loadingOne')}
			cancelTo="/users"
			onSubmit={handleSave}
		>
			<EmployeeField
				idPrefix="user-edit"
				data={data}
				employeeId={employeeId()}
				onEmployeeChange={setEmployeeId}
				tenantId={tenantId()}
				onTenantChange={setTenantId}
				ownLogin={form.record()?.username}
			/>
			<LoginField idPrefix="user-edit" employee={employee()} />
			<SelectField
				id="user-edit-role"
				label={t('entity.role.one')}
				required
				value={roleId()}
				onChange={setRoleId}
				options={row_options(roles() ?? [])}
				hint={<RoleHint role={role()} />}
			/>
			<ScopeField
				idPrefix="user-edit"
				data={data}
				role={role()}
				employee={employee()}
				tenantId={tenantId()}
				onTenantChange={setTenantId}
			/>
			<TextField
				id="user-edit-password"
				label={t('user.newPassword')}
				type="password"
				placeholder={t('user.keepPassword')}
				value={password()}
				onInput={setPassword}
				autocomplete="new-password"
			/>
		</FormPage>
	)
}
