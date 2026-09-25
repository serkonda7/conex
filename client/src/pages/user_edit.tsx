import { Result } from 'better-result'
import { createResource, createSignal, type JSX, Show } from 'solid-js'
import { fetch_tenants } from '../api_tenancy'
import { fetch_user, type UserRole, update_user } from '../api_users'
import {
	EditActions,
	EditPageShell,
	FormError,
	Hint,
	SelectField,
	TextField,
} from '../components/form'
import { t } from '../i18n'
import { roleOptions } from '../i18n/labels'
import { navigate } from '../router'
import { useEditForm } from '../util/form'

/** /users/:id/edit — admin-only role, tenant-scope, and password form. */
export function UserEditPage(props: { id: number }): JSX.Element {
	const [role, setRole] = createSignal<UserRole>('viewer')
	const [tenantId, setTenantId] = createSignal<string>('')
	const [password, setPassword] = createSignal('')
	const { formError, setFormError, saving, setSaving, loaded, setLoaded } = useEditForm()

	const [user] = createResource(
		() => props.id,
		async (id: number) => {
			const res = await fetch_user(id)
			if (Result.isError(res)) {
				setFormError(res.error.message)
				return null
			}
			setRole(res.value.role)
			setTenantId(res.value.tenant_id === null ? '' : String(res.value.tenant_id))
			setLoaded(true)
			return res.value
		},
	)

	const [tenantsPage] = createResource(async () => {
		const res = await fetch_tenants({ limit: 200 })
		if (Result.isError(res)) {
			return null
		}
		return res.value
	})

	async function handleSave(e: SubmitEvent): Promise<void> {
		e.preventDefault()
		setFormError(null)
		const tenant = tenantId() === '' ? null : Number(tenantId())
		if (role() === 'admin' && tenant !== null) {
			setFormError(t('user.adminGlobal'))
			return
		}
		setSaving(true)
		const res = await update_user(props.id, {
			role: role(),
			tenant_id: tenant,
			...(password() ? { password: password() } : {}),
		})
		setSaving(false)
		if (Result.isError(res)) {
			setFormError(res.error.message)
			return
		}
		navigate('/users')
	}

	return (
		<EditPageShell
			name={user()?.username}
			title={t('user.editTitle')}
			loaded={loaded()}
			loadingText={t('user.loadingOne')}
			onSubmit={handleSave}
		>
			<SelectField
				id="user-edit-role"
				label={t('user.role')}
				value={role()}
				onChange={(value: string): void => {
					setRole(value as UserRole)
				}}
				options={roleOptions()}
				hint={
					<Hint>
						{t('user.roleHint')} {t('user.roleHintLastAdmin')}
					</Hint>
				}
			/>
			<Show when={role() !== 'admin'}>
				<SelectField
					id="user-edit-tenant"
					label={t('user.tenantScope')}
					value={tenantId()}
					onChange={setTenantId}
					options={(tenantsPage()?.items ?? []).map((tenant) => ({
						value: String(tenant.id),
						label: tenant.name,
					}))}
					emptyLabel={t('common.allTenants')}
					hint={<Hint>{t('user.tenantHint')}</Hint>}
				/>
			</Show>
			<TextField
				id="user-edit-password"
				label={t('user.newPassword')}
				type="password"
				placeholder={t('user.keepPassword')}
				value={password()}
				onInput={setPassword}
				autocomplete="new-password"
			/>
			<FormError message={formError} />
			<EditActions saving={saving()} cancelTo="/users" />
		</EditPageShell>
	)
}
