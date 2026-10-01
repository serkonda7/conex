import { createSignal, type JSX, Show } from 'solid-js'
import { fetch_roles, type RoleJson } from '../../api/roles'
import { fetch_tenants } from '../../api/tenancy'
import { create_user } from '../../api/users'
import { FormPage, Hint, row_options, SelectField, TextField } from '../../components/form'
import { t } from '../../i18n'
import { type FormValues, is_add_another_submit, submit_form, useFormState } from '../../lib/form'
import { createRows } from '../../lib/resource'
import { parseId } from '../../lib/router'
import { managesUsers, RoleHint } from './role_hint'

/** /users/add — account create form (`users.manage`). */
export function UserAddPage(): JSX.Element {
	const form = useFormState()
	const [username, setUsername] = createSignal('')
	const [password, setPassword] = createSignal('')
	const [roleId, setRoleId] = createSignal('')
	const [tenantId, setTenantId] = createSignal('')
	const [tenants] = createRows(fetch_tenants, form.setError)
	const [roles] = createRows(fetch_roles, form.setError)
	const role = (): RoleJson | undefined => roles()?.find((r) => r.id === parseId(roleId()))

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
					tenant_id: managesUsers(role()) ? null : parseId(tenantId()),
				}),
			navigateTo: '/users',
			onSuccess: is_add_another_submit(e) ? () => setUsername('') : undefined,
		})
	}

	return (
		<FormPage form={form} title={t('user.addTitle')} cancelTo="/users" onSubmit={handleCreate}>
			<TextField
				id="user-username"
				label={t('auth.username')}
				required
				placeholder={t('user.usernamePlaceholder')}
				maxLength={64}
				autocomplete="off"
				autofocus
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
				label={t('user.role')}
				required
				value={roleId()}
				onChange={setRoleId}
				options={row_options(roles() ?? [])}
				hint={<RoleHint role={role()} />}
			/>
			<Show when={!managesUsers(role())}>
				<SelectField
					id="user-tenant"
					label={t('user.tenantScope')}
					value={tenantId()}
					onChange={setTenantId}
					options={row_options(tenants() ?? [])}
					emptyLabel={t('common.allTenants')}
					hint={<Hint>{t('user.tenantHint')}</Hint>}
				/>
			</Show>
		</FormPage>
	)
}
