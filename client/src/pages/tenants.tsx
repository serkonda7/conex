import { Result } from 'better-result'
import type { InputEventAndTarget } from 'shared/src/types'
import type { JSX } from 'solid-js'
import { createResource, createSignal, For, Show } from 'solid-js'
import { create_tenant, delete_tenant, fetch_tenants, type TenantRow } from '../api_p1'

/** /tenants — tenant table with inline create form. */
export function TenantsPage(): JSX.Element {
	const [error, setError] = createSignal<string | null>(null)
	const [tenantName, setTenantName] = createSignal('')
	const [tenantSlug, setTenantSlug] = createSignal('')

	const [tenants, { refetch: refetchTenants }] = createResource(async () => {
		const res = await fetch_tenants()
		if (Result.isError(res)) {
			setError(res.error.message)
			return []
		}
		return res.value.items
	})

	async function handleCreateTenant(e: SubmitEvent): Promise<void> {
		e.preventDefault()
		setError(null)
		const res = await create_tenant(tenantName(), tenantSlug())
		if (Result.isError(res)) {
			setError(res.error.message)
			return
		}
		setTenantName('')
		setTenantSlug('')
		void refetchTenants()
	}

	async function handleDeleteTenant(id: string): Promise<void> {
		setError(null)
		const res = await delete_tenant(id)
		if (Result.isError(res)) {
			setError(res.error.message)
			return
		}
		void refetchTenants()
	}

	return (
		<div>
			<h2>Tenants</h2>
			<form onSubmit={handleCreateTenant}>
				<input
					placeholder="Name"
					value={tenantName()}
					onInput={(e: InputEventAndTarget) => setTenantName(e.currentTarget.value)}
				/>
				<input
					placeholder="slug"
					value={tenantSlug()}
					onInput={(e: InputEventAndTarget) => setTenantSlug(e.currentTarget.value)}
				/>
				<button type="submit">Add tenant</button>
			</form>
			<table>
				<thead>
					<tr>
						<th>Name</th>
						<th>Slug</th>
						<th>Actions</th>
					</tr>
				</thead>
				<tbody>
					<For each={tenants() ?? []}>
						{(t: TenantRow): JSX.Element => (
							<tr>
								<td>{t.name}</td>
								<td>
									<code>{t.slug}</code>
								</td>
								<td>
									<button
										type="button"
										class="btn-danger"
										onClick={() => handleDeleteTenant(t.id)}
									>
										Delete
									</button>
								</td>
							</tr>
						)}
					</For>
				</tbody>
			</table>
			<Show when={!tenants.loading && (tenants() ?? []).length === 0}>
				<p class="empty">No tenants yet. Add the first one above.</p>
			</Show>
			<Show when={error()}>
				<div class="app-inline-error">{error()}</div>
			</Show>
		</div>
	)
}
