import { createSignal, type JSX, Show } from 'solid-js'
import { fetch_tenants } from '../../api/tenancy'
import { create_user, type UserRole } from '../../api/users'
import { FormPage, Hint, row_options, SelectField, TextField } from '../../components/form'
import { t } from '../../i18n'
import { roleOptions } from '../../i18n/labels'
import { type FormValues, is_add_another_submit, submit_form, useFormState } from '../../lib/form'
import { createRows } from '../../lib/resource'
import { parseId } from '../../lib/router'
import { RoleHint } from './role_hint'

/** /users/add — admin-only account create form. */
export function UserAddPage(): JSX.Element {
	const form = useFormState()
	const [username, setUsername] = createSignal('')
	const [password, setPassword] = createSignal('')
	const [role, setRole] = createSignal<UserRole>('viewer')
	const [tenantId, setTenantId] = createSignal('')
	const [tenants] = createRows(fetch_tenants, form.setError)

	function validate(): string | null {
		if (!password()) {
			return t('auth.passwordRequired')
		}
		return role() === 'admin' && parseId(tenantId()) !== null ? t('user.adminGlobal') : null
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
					role: role(),
					tenant_id: parseId(tenantId()),
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
				value={role()}
				onChange={(value: string) => setRole(value as UserRole)}
				options={roleOptions()}
				hint={<RoleHint />}
			/>
			<Show when={role() !== 'admin'}>
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
