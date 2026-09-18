import { Result } from 'better-result'
import type { JSX } from 'solid-js'
import { createResource, createSignal, For, Show } from 'solid-js'
import { delete_tenant, fetch_tenants, type TenantRow } from '../api_p1'
import { navigate } from '../router'

/** /tenants — tenant table with a link to the /tenants/add create form. */
export function TenantsPage(): JSX.Element {
	const [error, setError] = createSignal<string | null>(null)

	const [tenants, { refetch: refetchTenants }] = createResource(async () => {
		const res = await fetch_tenants()
		if (Result.isError(res)) {
			setError(res.error.message)
			return []
		}
		return res.value.items
	})

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
			<div class="page-header">
				<h2>Tenants</h2>
				<button type="button" class="btn-add" onClick={() => navigate('/tenants/add')}>
					+ Add
				</button>
			</div>
			<table>
				<thead>
					<tr>
						<th>Name</th>
						<th>Slug</th>
						<th>Description</th>
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
								<td>{t.description || '—'}</td>
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
