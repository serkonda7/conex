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
import { navigate } from '../router'
import { useEditForm } from '../util/form'

const ROLES: UserRole[] = ['admin', 'editor', 'viewer']

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
			setFormError('Admin accounts are global and cannot be limited to a tenant.')
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
			backTo="/users"
			backLabel={user()?.username ?? 'User'}
			title="Edit user"
			loaded={loaded()}
			loadingText="Loading user…"
			onSubmit={handleSave}
		>
			<SelectField
				id="user-edit-role"
				label="Role"
				value={role()}
				onChange={(value: string): void => {
					setRole(value as UserRole)
				}}
				options={ROLES.map((r) => ({ value: r, label: r }))}
				hint={
					<Hint>
						Admin manages users and everything; editor reads and writes inventory;
						viewer reads only. The last admin cannot be demoted.
					</Hint>
				}
			/>
			<Show when={role() !== 'admin'}>
				<SelectField
					id="user-edit-tenant"
					label="Tenant scope"
					value={tenantId()}
					onChange={setTenantId}
					options={(tenantsPage()?.items ?? []).map((t) => ({
						value: String(t.id),
						label: t.name,
					}))}
					emptyLabel="All tenants"
					hint={
						<Hint>
							Limit an editor or viewer to a single tenant. Empty means global.
						</Hint>
					}
				/>
			</Show>
			<TextField
				id="user-edit-password"
				label="New password"
				type="password"
				placeholder="Leave empty to keep the current password"
				value={password()}
				onInput={setPassword}
				autocomplete="new-password"
			/>
			<FormError message={formError} />
			<EditActions saving={saving()} cancelTo="/users" />
		</EditPageShell>
	)
}
