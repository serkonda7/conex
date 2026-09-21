import type { JSX } from 'solid-js'
import { createResource, createSignal, Show } from 'solid-js'
import { fetch_tenants } from '../api_p1'
import { create_user, type UserRole } from '../api_users'
import {
	FormActions,
	FormError,
	type FormOption,
	FormPage,
	Hint,
	row_options,
	SelectField,
	TextField,
} from '../components/form'
import { type FormValues, load_rows, submit_form } from '../util/form'

const ROLES: UserRole[] = ['admin', 'editor', 'viewer']

const ROLE_OPTIONS: FormOption[] = ROLES.map((role: UserRole) => ({ value: role, label: role }))

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
			nameError: 'Username is required.',
			validate: (): string | null => {
				if (!password()) {
					return 'Password is required.'
				}
				if (role() === 'admin' && tenant !== null) {
					return 'Admin accounts are global and cannot be limited to a tenant.'
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
		})
	}

	return (
		<FormPage backTo="/users" backLabel="Users" title="Add a new user" onSubmit={handleCreate}>
			<TextField
				id="user-username"
				label="Username"
				required
				placeholder="teammate"
				maxLength={64}
				autocomplete="off"
				autofocus
				value={username()}
				onInput={setUsername}
			/>
			<TextField
				id="user-password"
				label="Password"
				required
				type="password"
				placeholder="Temporary password"
				autocomplete="new-password"
				value={password()}
				onInput={setPassword}
			/>
			<SelectField
				id="user-role"
				label="Role"
				value={role()}
				onChange={(value: string) => setRole(value as UserRole)}
				options={ROLE_OPTIONS}
				hint={
					<Hint>
						Admin manages users and everything; editor reads and writes inventory;
						viewer reads only.
					</Hint>
				}
			/>
			<Show when={role() !== 'admin'}>
				<SelectField
					id="user-tenant"
					label="Tenant scope"
					value={tenantId()}
					onChange={setTenantId}
					options={row_options(tenants() ?? [])}
					emptyLabel="All tenants"
					hint={
						<Hint>
							Limit an editor or viewer to a single tenant. Empty means global.
						</Hint>
					}
				/>
			</Show>
			<FormError message={formError} />
			<FormActions saving={saving()} cancelTo="/users" />
		</FormPage>
	)
}
