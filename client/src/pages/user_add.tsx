import type { JSX } from 'solid-js'
import { createResource, createSignal, Show } from 'solid-js'
import { fetch_tenants } from '../api_tenancy'
import { create_user, type UserRole } from '../api_users'
import {
	FormActions,
	FormError,
	FormPage,
	Hint,
	row_options,
	SelectField,
	TextField,
} from '../components/form'
import { t, tp } from '../i18n'
import { roleOptions } from '../i18n/labels'
import { type FormValues, is_add_another_submit, load_rows, submit_form } from '../util/form'

/** /users/add — admin-only account create form. */
export function UserAddPage(): JSX.Element {
	const [username, setUsername] = createSignal('')
	const [password, setPassword] = createSignal('')
	const [role, setRole] = createSignal<UserRole>('viewer')
	const [tenantId, setTenantId] = createSignal<string>('')
	const [formError, setFormError] = createSignal<string | null>(null)
	const [saving, setSaving] = createSignal(false)

	const [tenants] = createResource(() =>
		load_rows(() => fetch_tenants({ limit: 200 }), setFormError),
	)

	async function handleCreate(e: SubmitEvent): Promise<void> {
		e.preventDefault()
		const tenant = tenantId() === '' ? null : Number(tenantId())
		await submit_form({
			name: username(),
			nameError: t('auth.usernameRequired'),
			validate: (): string | null => {
				if (!password()) {
					return t('auth.passwordRequired')
				}
				if (role() === 'admin' && tenant !== null) {
					return t('user.adminGlobal')
				}
				return null
			},
			save: (values: FormValues) =>
				create_user({
					username: values.name,
					password: password(),
					role: role(),
					tenant_id: tenant,
				}),
			setError: setFormError,
			setSaving,
			navigateTo: '/users',
			onSuccess: is_add_another_submit(e) ? () => setUsername('') : undefined,
		})
	}

	return (
		<FormPage
			backTo="/users"
			backLabel={tp('entity.user', 2)}
			title={t('user.addTitle')}
			onSubmit={handleCreate}
		>
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
				hint={<Hint>{t('user.roleHint')}</Hint>}
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
			<FormError message={formError} />
			<FormActions saving={saving()} cancelTo="/users" />
		</FormPage>
	)
}
