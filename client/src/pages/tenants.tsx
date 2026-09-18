import { Result } from 'better-result'
import type { InputEventAndTarget } from 'shared/src/types'
import type { JSX } from 'solid-js'
import { createResource, createSignal, For, Show } from 'solid-js'
import {
	create_tenant,
	create_tenant_group,
	delete_tenant,
	delete_tenant_group,
	fetch_tenant_groups,
	fetch_tenants,
	type TenantGroupRow,
	type TenantRow,
} from '../api_p1'

/** /tenants — tenant-group and tenant tables with inline create forms. */
export function TenantsPage(): JSX.Element {
	const [error, setError] = createSignal<string | null>(null)
	const [groupName, setGroupName] = createSignal('')
	const [groupSlug, setGroupSlug] = createSignal('')
	const [tenantName, setTenantName] = createSignal('')
	const [tenantSlug, setTenantSlug] = createSignal('')
	const [tenantGroup, setTenantGroup] = createSignal('')

	const [groups, { refetch: refetchGroups }] = createResource(async () => {
		const res = await fetch_tenant_groups()
		if (Result.isError(res)) {
			setError(res.error.message)
			return []
		}
		return res.value.items
	})
	const [tenants, { refetch: refetchTenants }] = createResource(async () => {
		const res = await fetch_tenants()
		if (Result.isError(res)) {
			setError(res.error.message)
			return []
		}
		return res.value.items
	})

	function groupNameOf(id: string | null): string {
		if (!id) {
			return '—'
		}
		return groups()?.find((g) => g.id === id)?.name ?? id.slice(0, 8)
	}

	async function handleCreateGroup(e: SubmitEvent): Promise<void> {
		e.preventDefault()
		setError(null)
		const res = await create_tenant_group(groupName(), groupSlug())
		if (Result.isError(res)) {
			setError(res.error.message)
			return
		}
		setGroupName('')
		setGroupSlug('')
		void refetchGroups()
	}

	async function handleCreateTenant(e: SubmitEvent): Promise<void> {
		e.preventDefault()
		setError(null)
		const res = await create_tenant(tenantName(), tenantSlug(), tenantGroup() || null)
		if (Result.isError(res)) {
			setError(res.error.message)
			return
		}
		setTenantName('')
		setTenantSlug('')
		setTenantGroup('')
		void refetchTenants()
	}

	async function handleDeleteGroup(id: string): Promise<void> {
		setError(null)
		const res = await delete_tenant_group(id)
		if (Result.isError(res)) {
			setError(res.error.message)
			return
		}
		void refetchGroups()
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
			<h2>Tenant groups</h2>
			<form onSubmit={handleCreateGroup}>
				<input
					placeholder="Name"
					value={groupName()}
					onInput={(e: InputEventAndTarget) => setGroupName(e.currentTarget.value)}
				/>
				<input
					placeholder="slug"
					value={groupSlug()}
					onInput={(e: InputEventAndTarget) => setGroupSlug(e.currentTarget.value)}
				/>
				<button type="submit">Add group</button>
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
					<For each={groups() ?? []}>
						{(g: TenantGroupRow): JSX.Element => (
							<tr>
								<td>{g.name}</td>
								<td>
									<code>{g.slug}</code>
								</td>
								<td>
									<button type="button" onClick={() => handleDeleteGroup(g.id)}>
										Delete
									</button>
								</td>
							</tr>
						)}
					</For>
				</tbody>
			</table>

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
				<select
					value={tenantGroup()}
					onChange={(e: Event & { currentTarget: HTMLSelectElement }) =>
						setTenantGroup(e.currentTarget.value)
					}
				>
					<option value="">No group</option>
					<For each={groups() ?? []}>
						{(g: TenantGroupRow): JSX.Element => <option value={g.id}>{g.name}</option>}
					</For>
				</select>
				<button type="submit">Add tenant</button>
			</form>
			<table>
				<thead>
					<tr>
						<th>Name</th>
						<th>Slug</th>
						<th>Group</th>
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
								<td>{groupNameOf(t.group_id)}</td>
								<td>
									<button type="button" onClick={() => handleDeleteTenant(t.id)}>
										Delete
									</button>
								</td>
							</tr>
						)}
					</For>
				</tbody>
			</table>
			<Show when={error()}>
				<div class="app-inline-error">{error()}</div>
			</Show>
		</div>
	)
}
