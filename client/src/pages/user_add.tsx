import { Result } from 'better-result'
import type { InputEventAndTarget } from 'shared/src/types'
import type { JSX } from 'solid-js'
import { createResource, createSignal, For, onMount, Show } from 'solid-js'
import { fetch_tenants } from '../api_p1'
import { create_user, type UserRole } from '../api_users'
import { navigate } from '../router'

function go(e: MouseEvent, to: string): void {
	e.preventDefault()
	navigate(to)
}

const ROLES: UserRole[] = ['admin', 'editor', 'viewer']

/** /users/add — admin-only account create form. */
export function UserAddPage(): JSX.Element {
	const [username, setUsername] = createSignal('')
	const [password, setPassword] = createSignal('')
	const [role, setRole] = createSignal<UserRole>('viewer')
	const [tenantId, setTenantId] = createSignal<string>('')
	const [formError, setFormError] = createSignal<string | null>(null)
	const [saving, setSaving] = createSignal(false)
	let usernameInput: HTMLInputElement | undefined

	onMount(() => {
		usernameInput?.focus()
	})

	const [tenantsPage] = createResource(async () => {
		const res = await fetch_tenants({ limit: 200 })
		if (Result.isError(res)) {
			return null
		}
		return res.value
	})

	async function handleCreate(e: SubmitEvent): Promise<void> {
		e.preventDefault()
		setFormError(null)
		const trimmedUsername = username().trim()
		if (!trimmedUsername) {
			setFormError('Username is required.')
			return
		}
		if (!password()) {
			setFormError('Password is required.')
			return
		}
		const tenant = tenantId() === '' ? null : Number(tenantId())
		if (role() === 'admin' && tenant !== null) {
			setFormError('Admin accounts are global and cannot be limited to a tenant.')
			return
		}
		setSaving(true)
		const res = await create_user({
			username: trimmedUsername,
			password: password(),
			role: role(),
			tenant_id: tenant,
		})
		setSaving(false)
		if (Result.isError(res)) {
			setFormError(res.error.message)
			return
		}
		navigate('/users')
	}

	return (
		<div class="form-page">
			<p>
				<a href="/users" onClick={(e: MouseEvent): void => go(e, '/users')}>
					← Users
				</a>
			</p>
			<h2>Add a new user</h2>
			<form class="form-stacked" onSubmit={handleCreate}>
				<div class="field">
					<label for="user-username">
						Username{' '}
						<span class="required" aria-hidden="true">
							*
						</span>
					</label>
					<input
						id="user-username"
						ref={usernameInput}
						type="text"
						placeholder="teammate"
						required
						maxLength={64}
						value={username()}
						onInput={(e: InputEventAndTarget) => setUsername(e.currentTarget.value)}
						autocomplete="off"
					/>
				</div>
				<div class="field">
					<label for="user-password">
						Password{' '}
						<span class="required" aria-hidden="true">
							*
						</span>
					</label>
					<input
						id="user-password"
						type="password"
						placeholder="Temporary password"
						required
						value={password()}
						onInput={(e: InputEventAndTarget) => setPassword(e.currentTarget.value)}
						autocomplete="new-password"
					/>
				</div>
				<div class="field">
					<label for="user-role">Role</label>
					<select
						id="user-role"
						value={role()}
						onChange={(e: Event & { currentTarget: HTMLSelectElement }) =>
							setRole(e.currentTarget.value as UserRole)
						}
					>
						<For each={ROLES}>{(r: UserRole) => <option value={r}>{r}</option>}</For>
					</select>
					<p class="field-hint">
						Admin manages users and everything; editor reads and writes inventory;
						viewer reads only.
					</p>
				</div>
				<Show when={role() !== 'admin'}>
					<div class="field">
						<label for="user-tenant">Tenant scope</label>
						<select
							id="user-tenant"
							value={tenantId()}
							onChange={(e: Event & { currentTarget: HTMLSelectElement }) =>
								setTenantId(e.currentTarget.value)
							}
						>
							<option value="">All tenants</option>
							<For each={tenantsPage()?.items ?? []}>
								{(t: { id: number; name: string }) => (
									<option value={String(t.id)}>{t.name}</option>
								)}
							</For>
						</select>
						<p class="field-hint">
							Limit an editor or viewer to a single tenant. Empty means global.
						</p>
					</div>
				</Show>
				<Show when={formError()}>
					<div class="app-inline-error" role="alert">
						{formError()}
					</div>
				</Show>
				<div class="form-actions">
					<button type="submit" disabled={saving()}>
						{saving() ? 'Creating…' : 'Create'}
					</button>
					<button type="button" onClick={() => navigate('/users')} disabled={saving()}>
						Cancel
					</button>
				</div>
			</form>
		</div>
	)
}
