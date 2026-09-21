import { IconPencil, IconTrash } from '@tabler/icons-solidjs'
import { Result } from 'better-result'
import type { JSX } from 'solid-js'
import { createResource, createSignal, For, Show } from 'solid-js'
import {
	delete_tenant,
	fetch_site_groups,
	fetch_sites,
	fetch_tenant,
	type SiteGroupRow,
	type SiteRow,
} from '../api_p1'
import { fetch_racks, type RackRow } from '../api_p2'
import { type DeviceRow, fetch_devices } from '../api_p4'
import { navigate } from '../router'

function go(e: MouseEvent, to: string): void {
	e.preventDefault()
	navigate(to)
}

/**
 * /tenants/:id — tenant detail: header with slug/description/comments,
 * related-object counts, and the related sites/racks/devices tables.
 * Tenant name links elsewhere navigate here; the edit dialog stays inline
 * so the list page keeps its quick-edit affordance.
 */
export function TenantDetailPage(props: { id: number }): JSX.Element {
	const [error, setError] = createSignal<string | null>(null)

	const [tenant] = createResource(
		() => props.id,
		async (id: number) => {
			setError(null)
			const res = await fetch_tenant(id)
			if (Result.isError(res)) {
				setError(res.error.message)
				return null
			}
			return res.value
		},
	)
	const [sites] = createResource(
		() => props.id,
		async (id: number) => {
			const res = await fetch_sites({ tenant: id })
			if (Result.isError(res)) {
				setError(res.error.message)
				return []
			}
			return res.value.items
		},
	)
	const [siteGroups] = createResource(
		() => props.id,
		async (id: number) => {
			const res = await fetch_site_groups({ tenant: id })
			if (Result.isError(res)) {
				setError(res.error.message)
				return []
			}
			return res.value.items
		},
	)
	const [racks] = createResource(
		() => props.id,
		async (id: number) => {
			const res = await fetch_racks({ tenant: id })
			if (Result.isError(res)) {
				setError(res.error.message)
				return []
			}
			return res.value.items
		},
	)
	const [devices] = createResource(
		() => props.id,
		async (id: number) => {
			const res = await fetch_devices({ tenant: id })
			if (Result.isError(res)) {
				setError(res.error.message)
				return []
			}
			return res.value.items
		},
	)

	async function handleDelete(): Promise<void> {
		const t = tenant()
		if (!t) {
			return
		}
		if (!window.confirm(`Delete tenant "${t.name}"?`)) {
			return
		}
		setError(null)
		const res = await delete_tenant(props.id)
		if (Result.isError(res)) {
			setError(res.error.message)
			return
		}
		navigate('/tenants')
	}

	const siteCount = (): number => sites()?.length ?? 0
	const siteGroupCount = (): number => siteGroups()?.length ?? 0
	const rackCount = (): number => racks()?.length ?? 0
	const deviceCount = (): number => devices()?.length ?? 0

	return (
		<div>
			<p>
				<a href="/tenants" onClick={(e: MouseEvent): void => go(e, '/tenants')}>
					← Tenants
				</a>
			</p>
			<Show when={!tenant.loading} fallback={<p class="skeleton">Loading tenant…</p>}>
				<Show when={tenant()} fallback={<p class="empty">Tenant not found.</p>}>
					<div class="page-header">
						<h2>
							{tenant()?.name} <code>{tenant()?.slug}</code>
						</h2>
						<div class="form-actions">
							<button
								type="button"
								onClick={() => navigate(`/tenants/${props.id}/edit`)}
							>
								<span aria-hidden="true" class="app-nav-icon">
									<IconPencil size={14} />
								</span>{' '}
								Edit
							</button>
							<button type="button" class="btn-danger" onClick={handleDelete}>
								<span aria-hidden="true" class="app-nav-icon">
									<IconTrash size={14} />
								</span>{' '}
								Delete
							</button>
						</div>
					</div>
					<p class="page-subtitle">{tenant()?.description || 'No description.'}</p>

					<div class="detail-stats">
						<a class="detail-stat" href="#tenant-sites">
							<span class="detail-stat-value">{siteCount()}</span>{' '}
							<span class="detail-stat-label">
								Site{siteCount() === 1 ? '' : 's'}
							</span>
						</a>
						<a class="detail-stat" href="#tenant-site-groups">
							<span class="detail-stat-value">{siteGroupCount()}</span>{' '}
							<span class="detail-stat-label">
								Site group{siteGroupCount() === 1 ? '' : 's'}
							</span>
						</a>
						<a class="detail-stat" href="#tenant-racks">
							<span class="detail-stat-value">{rackCount()}</span>{' '}
							<span class="detail-stat-label">
								Rack{rackCount() === 1 ? '' : 's'}
							</span>
						</a>
						<a class="detail-stat" href="#tenant-devices">
							<span class="detail-stat-value">{deviceCount()}</span>{' '}
							<span class="detail-stat-label">
								Device{deviceCount() === 1 ? '' : 's'}
							</span>
						</a>
					</div>

					<section class="card" aria-label="Tenant details">
						<dl class="detail-grid">
							<dt>Slug</dt>
							<dd>
								<code>{tenant()?.slug}</code>
							</dd>
							<dt>Description</dt>
							<dd>{tenant()?.description || '—'}</dd>
							<dt>Comments</dt>
							<dd>{tenant()?.comments || '—'}</dd>
						</dl>
					</section>
				</Show>
			</Show>

			<h3 id="tenant-sites">
				Sites <span class="badge">{siteCount()}</span>
			</h3>
			<Show when={!sites.loading} fallback={<p class="skeleton">Loading sites…</p>}>
				<Show
					when={siteCount() > 0}
					fallback={<p class="empty">No sites for this tenant yet.</p>}
				>
					<table>
						<thead>
							<tr>
								<th>Name</th>
								<th>Slug</th>
							</tr>
						</thead>
						<tbody>
							<For each={sites() ?? []}>
								{(s: SiteRow): JSX.Element => (
									<tr>
										<td>
											<a
												href={`/sites/${s.id}`}
												onClick={(e: MouseEvent): void =>
													go(e, `/sites/${s.id}`)
												}
											>
												{s.name}
											</a>
										</td>
										<td>
											<code>{s.slug}</code>
										</td>
									</tr>
								)}
							</For>
						</tbody>
					</table>
				</Show>
			</Show>
			<p>
				<a
					href={`/sites?tenant=${props.id}`}
					onClick={(e: MouseEvent): void => go(e, `/sites?tenant=${props.id}`)}
				>
					View in Sites →
				</a>
			</p>

			<h3 id="tenant-site-groups">
				Site groups <span class="badge">{siteGroupCount()}</span>
			</h3>
			<Show
				when={!siteGroups.loading}
				fallback={<p class="skeleton">Loading site groups…</p>}
			>
				<Show
					when={siteGroupCount() > 0}
					fallback={<p class="empty">No site groups for this tenant yet.</p>}
				>
					<table>
						<thead>
							<tr>
								<th>Name</th>
								<th>Slug</th>
							</tr>
						</thead>
						<tbody>
							<For each={siteGroups() ?? []}>
								{(g: SiteGroupRow): JSX.Element => (
									<tr>
										<td>
											<a
												href={`/site-groups/${g.id}`}
												onClick={(e: MouseEvent): void =>
													go(e, `/site-groups/${g.id}`)
												}
											>
												{g.name}
											</a>
										</td>
										<td>
											<code>{g.slug}</code>
										</td>
									</tr>
								)}
							</For>
						</tbody>
					</table>
				</Show>
			</Show>
			<p>
				<a
					href={`/site-groups?tenant=${props.id}`}
					onClick={(e: MouseEvent): void => go(e, `/site-groups?tenant=${props.id}`)}
				>
					View in Site Groups →
				</a>
			</p>

			<h3 id="tenant-racks">
				Racks <span class="badge">{rackCount()}</span>
			</h3>
			<Show when={!racks.loading} fallback={<p class="skeleton">Loading racks…</p>}>
				<Show
					when={rackCount() > 0}
					fallback={<p class="empty">No racks for this tenant yet.</p>}
				>
					<table>
						<thead>
							<tr>
								<th>Name</th>
								<th>Height</th>
								<th>Status</th>
							</tr>
						</thead>
						<tbody>
							<For each={racks() ?? []}>
								{(r: RackRow): JSX.Element => (
									<tr>
										<td>
											<a
												href={`/racks/${r.id}`}
												onClick={(e: MouseEvent): void =>
													go(e, `/racks/${r.id}`)
												}
											>
												{r.name}
											</a>
										</td>
										<td>{r.height_u}U</td>
										<td>
											<span class={`badge badge-${r.status}`}>
												{r.status}
											</span>
										</td>
									</tr>
								)}
							</For>
						</tbody>
					</table>
				</Show>
			</Show>

			<h3 id="tenant-devices">
				Devices <span class="badge">{deviceCount()}</span>
			</h3>
			<Show when={!devices.loading} fallback={<p class="skeleton">Loading devices…</p>}>
				<Show
					when={deviceCount() > 0}
					fallback={<p class="empty">No devices for this tenant yet.</p>}
				>
					<table>
						<thead>
							<tr>
								<th>Name</th>
								<th>Status</th>
								<th>Asset tag</th>
							</tr>
						</thead>
						<tbody>
							<For each={devices() ?? []}>
								{(d: DeviceRow): JSX.Element => (
									<tr>
										<td>
											<a
												href={`/devices/${d.id}`}
												onClick={(e: MouseEvent): void =>
													go(e, `/devices/${d.id}`)
												}
											>
												{d.name}
											</a>
										</td>
										<td>
											<span class={`badge badge-${d.status}`}>
												{d.status}
											</span>
										</td>
										<td>{d.asset_tag ?? '—'}</td>
									</tr>
								)}
							</For>
						</tbody>
					</table>
				</Show>
			</Show>
			<p>
				<a
					href={`/devices?tenant=${props.id}`}
					onClick={(e: MouseEvent): void => go(e, `/devices?tenant=${props.id}`)}
				>
					View in Devices →
				</a>
			</p>

			<Show when={error()}>
				<div class="app-inline-error">{error()}</div>
			</Show>
		</div>
	)
}
