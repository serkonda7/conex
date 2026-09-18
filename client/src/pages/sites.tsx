import { Result } from 'better-result'
import type { InputEventAndTarget } from 'shared/src/types'
import type { JSX } from 'solid-js'
import { createEffect, createResource, createSignal, For, Show } from 'solid-js'
import {
	create_site,
	delete_site,
	fetch_sites,
	fetch_tenants,
	type SiteRow,
	type TenantRow,
} from '../api_p1'
import { navigate, queryParam } from '../router'

function go(e: MouseEvent, to: string): void {
	e.preventDefault()
	navigate(to)
}

/** /sites — site table with tenant filter and inline create form. */
export function SitesPage(): JSX.Element {
	const [error, setError] = createSignal<string | null>(null)
	const [name, setName] = createSignal('')
	const [slug, setSlug] = createSignal('')
	const [tenantId, setTenantId] = createSignal('')
	const [filterTenant, setFilterTenant] = createSignal(queryParam('tenant'))

	// Follow tenant links from the tenants table (`/sites?tenant=<id>`).
	createEffect(() => {
		setFilterTenant(queryParam('tenant'))
	})

	const [tenants] = createResource(async () => {
		const res = await fetch_tenants()
		if (Result.isError(res)) {
			setError(res.error.message)
			return []
		}
		return res.value.items
	})
	const [sites, { refetch }] = createResource(filterTenant, async (tenant) => {
		const res = await fetch_sites(tenant || undefined)
		if (Result.isError(res)) {
			setError(res.error.message)
			return []
		}
		return res.value.items
	})

	function tenantNameOf(id: string | null): string {
		if (!id) {
			return '—'
		}
		return tenants()?.find((t) => t.id === id)?.name ?? id.slice(0, 8)
	}

	async function handleCreate(e: SubmitEvent): Promise<void> {
		e.preventDefault()
		setError(null)
		const res = await create_site(name(), slug(), tenantId() || null)
		if (Result.isError(res)) {
			setError(res.error.message)
			return
		}
		setName('')
		setSlug('')
		setTenantId('')
		void refetch()
	}

	async function handleDelete(id: string): Promise<void> {
		setError(null)
		const res = await delete_site(id)
		if (Result.isError(res)) {
			setError(res.error.message)
			return
		}
		void refetch()
	}

	return (
		<div>
			<h2>Sites</h2>
			<p class="page-subtitle">Group racks by site and tenant.</p>
			<label>
				Tenant filter:{' '}
				<select
					value={filterTenant()}
					onChange={(e: Event & { currentTarget: HTMLSelectElement }) =>
						setFilterTenant(e.currentTarget.value)
					}
				>
					<option value="">All tenants</option>
					<For each={tenants() ?? []}>
						{(t: TenantRow): JSX.Element => <option value={t.id}>{t.name}</option>}
					</For>
				</select>
			</label>
			<form onSubmit={handleCreate}>
				<input
					placeholder="Name"
					value={name()}
					onInput={(e: InputEventAndTarget) => setName(e.currentTarget.value)}
				/>
				<input
					placeholder="slug"
					value={slug()}
					onInput={(e: InputEventAndTarget) => setSlug(e.currentTarget.value)}
				/>
				<select
					value={tenantId()}
					onChange={(e: Event & { currentTarget: HTMLSelectElement }) =>
						setTenantId(e.currentTarget.value)
					}
				>
					<option value="">No tenant</option>
					<For each={tenants() ?? []}>
						{(t: TenantRow): JSX.Element => <option value={t.id}>{t.name}</option>}
					</For>
				</select>
				<button type="submit">Add site</button>
			</form>
			<table>
				<thead>
					<tr>
						<th>Name</th>
						<th>Slug</th>
						<th>Tenant</th>
						<th>Actions</th>
					</tr>
				</thead>
				<tbody>
					<For each={sites() ?? []}>
						{(s: SiteRow): JSX.Element => (
							<tr>
								<td>
									<a
										href={`/sites/${s.id}`}
										onClick={(e: MouseEvent): void => go(e, `/sites/${s.id}`)}
									>
										{s.name}
									</a>
								</td>
								<td>
									<code>{s.slug}</code>
								</td>
								<td>{tenantNameOf(s.tenant_id)}</td>
								<td>
									<button
										type="button"
										class="btn-danger"
										onClick={() => handleDelete(s.id)}
									>
										Delete
									</button>
								</td>
							</tr>
						)}
					</For>
				</tbody>
			</table>
			<Show when={!sites.loading && (sites() ?? []).length === 0}>
				<p class="empty">No sites yet. Add the first one above.</p>
			</Show>
			<Show when={error()}>
				<div class="app-inline-error">{error()}</div>
			</Show>
		</div>
	)
}
