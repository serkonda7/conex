import { Result } from 'better-result'
import type { InputEventAndTarget } from 'shared/src/types'
import type { JSX } from 'solid-js'
import { createResource, createSignal, For, Show } from 'solid-js'
import { fetch_tenants } from '../api_p1'
import { fetch_user, type UserRole, update_user } from '../api_users'
import { navigate } from '../router'

function go(e: MouseEvent, to: string): void {
	e.preventDefault()
	navigate(to)
}

const ROLES: UserRole[] = ['admin', 'editor', 'viewer']

/** /users/:id/edit — admin-only role, tenant-scope, and password form. */
export function UserEditPage(props: { id: number }): JSX.Element {
	const [role, setRole] = createSignal<UserRole>('viewer')
	const [tenantId, setTenantId] = createSignal<string>('')
	const [password, setPassword] = createSignal('')
	const [formError, setFormError] = createSignal<string | null>(null)
	const [saving, setSaving] = createSignal(false)
	const [loaded, setLoaded] = createSignal(false)

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
		<div class="form-page">
			<p>
				<a href="/users" onClick={(e: MouseEvent): void => go(e, '/users')}>
					← {user()?.username ?? 'User'}
				</a>
			</p>
			<h2>Edit user</h2>
			<Show when={loaded()} fallback={<p class="skeleton">Loading user…</p>}>
				<form class="form-stacked" onSubmit={handleSave}>
					<div class="field">
						<label for="user-edit-role">Role</label>
						<select
							id="user-edit-role"
							value={role()}
							onChange={(e: Event & { currentTarget: HTMLSelectElement }) =>
								setRole(e.currentTarget.value as UserRole)
							}
						>
							<For each={ROLES}>
								{(r: UserRole) => <option value={r}>{r}</option>}
							</For>
						</select>
						<p class="field-hint">
							Admin manages users and everything; editor reads and writes inventory;
							viewer reads only. The last admin cannot be demoted.
						</p>
					</div>
					<Show when={role() !== 'admin'}>
						<div class="field">
							<label for="user-edit-tenant">Tenant scope</label>
							<select
								id="user-edit-tenant"
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
					<div class="field">
						<label for="user-edit-password">New password</label>
						<input
							id="user-edit-password"
							type="password"
							placeholder="Leave empty to keep the current password"
							value={password()}
							onInput={(e: InputEventAndTarget) => setPassword(e.currentTarget.value)}
							autocomplete="new-password"
						/>
					</div>
					<Show when={formError()}>
						<div class="app-inline-error" role="alert">
							{formError()}
						</div>
					</Show>
					<div class="form-actions">
						<button type="submit" disabled={saving()}>
							{saving() ? 'Saving…' : 'Save'}
						</button>
						<button
							type="button"
							onClick={() => navigate('/users')}
							disabled={saving()}
						>
							Cancel
						</button>
					</div>
				</form>
			</Show>
		</div>
	)
}
