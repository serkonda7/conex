import type { JSX } from 'solid-js'
import { createResource, createSignal, Show } from 'solid-js'
import { fetch_tenants } from '../api_tenancy'
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
import { type FormValues, is_add_another_submit, load_rows, submit_form } from '../util/form'

const ROLES: UserRole[] = ['admin', 'editor', 'viewer']

const ROLE_LABELS: Record<UserRole, string> = {
	admin: 'Administrator',
	editor: 'Redakteur',
	viewer: 'Betrachter',
}
const ROLE_OPTIONS: FormOption[] = ROLES.map((role: UserRole) => ({
	value: role,
	label: ROLE_LABELS[role],
}))

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
			nameError: 'Benutzername ist erforderlich.',
			validate: (): string | null => {
				if (!password()) {
					return 'Passwort ist erforderlich.'
				}
				if (role() === 'admin' && tenant !== null) {
					return 'Administratorkonten gelten global und können nicht auf einen Mandanten beschränkt werden.'
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
			backLabel="Benutzer"
			title="Neuen Benutzer hinzufügen"
			onSubmit={handleCreate}
		>
			<TextField
				id="user-username"
				label="Benutzername"
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
				label="Passwort"
				required
				type="password"
				placeholder="Temporäres Passwort"
				autocomplete="new-password"
				value={password()}
				onInput={setPassword}
			/>
			<SelectField
				id="user-role"
				label="Rolle"
				value={role()}
				onChange={(value: string) => setRole(value as UserRole)}
				options={ROLE_OPTIONS}
				hint={
					<Hint>
						Administratoren verwalten Benutzer und alle Einstellungen; Redakteure können
						das Inventar lesen und bearbeiten; Betrachter haben nur Lesezugriff.
					</Hint>
				}
			/>
			<Show when={role() !== 'admin'}>
				<SelectField
					id="user-tenant"
					label="Mandantenzuordnung"
					value={tenantId()}
					onChange={setTenantId}
					options={row_options(tenants() ?? [])}
					emptyLabel="Alle Mandanten"
					hint={
						<Hint>
							Beschränkt Redakteure oder Betrachter auf einen Mandanten. Ohne Auswahl
							gilt der Zugriff global.
						</Hint>
					}
				/>
			</Show>
			<FormError message={formError} />
			<FormActions saving={saving()} cancelTo="/users" />
		</FormPage>
	)
}
