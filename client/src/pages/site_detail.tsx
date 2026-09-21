import { IconPencil, IconTrash } from '@tabler/icons-solidjs'
import { Result } from 'better-result'
import type { InputEventAndTarget } from 'shared/src/types'
import type { JSX } from 'solid-js'
import { createMemo, createResource, createSignal, For, Show } from 'solid-js'
import {
	create_location,
	delete_location,
	delete_site,
	fetch_locations,
	fetch_site,
	fetch_site_group,
	fetch_tenant,
	type LocationRow,
} from '../api_p1'
import { fetch_racks, type RackRow } from '../api_p2'
import { type DeviceRow, fetch_devices } from '../api_p4'
import { navigate } from '../router'

function go(e: MouseEvent, to: string): void {
	e.preventDefault()
	navigate(to)
}

interface TreeNode {
	row: LocationRow
	children: TreeNode[]
}

/** Nests the flat location list into a forest ordered by name. */
function buildTree(rows: LocationRow[]): TreeNode[] {
	const byId = new Map<number, TreeNode>()
	for (const row of rows) {
		byId.set(row.id, { row, children: [] })
	}
	const roots: TreeNode[] = []
	for (const node of byId.values()) {
		const parent = node.row.parent_id ? byId.get(node.row.parent_id) : undefined
		if (parent) {
			parent.children.push(node)
		} else {
			roots.push(node)
		}
	}
	const byName = (a: TreeNode, b: TreeNode): number => a.row.name.localeCompare(b.row.name)
	for (const node of byId.values()) {
		node.children.sort(byName)
	}
	roots.sort(byName)
	return roots
}

function LocationBranch(props: {
	node: TreeNode
	trail: string[]
	onDelete: (id: number) => void
}): JSX.Element {
	const trail = [...props.trail, props.node.row.name]
	return (
		<li>
			<code>{trail.join(' > ')}</code>{' '}
			<button
				type="button"
				class="btn-danger"
				onClick={() => props.onDelete(props.node.row.id)}
			>
				Delete
			</button>
			<Show when={props.node.children.length > 0}>
				<ul>
					<For each={props.node.children}>
						{(child: TreeNode): JSX.Element => (
							<LocationBranch node={child} trail={trail} onDelete={props.onDelete} />
						)}
					</For>
				</ul>
			</Show>
		</li>
	)
}

/**
 * /sites/:id — site detail: header with slug/description, related-object
 * counts, and the related locations/racks/devices sections.
 */
export function SiteDetailPage(props: { id: number }): JSX.Element {
	const [error, setError] = createSignal<string | null>(null)
	const [name, setName] = createSignal('')
	const [slug, setSlug] = createSignal('')
	const [parentId, setParentId] = createSignal('')

	const [site] = createResource(
		() => props.id,
		async (id: number) => {
			setError(null)
			const res = await fetch_site(id)
			if (Result.isError(res)) {
				setError(res.error.message)
				return null
			}
			return res.value
		},
	)
	const tenantId = createMemo(() => site()?.tenant_id ?? null)
	const [tenant] = createResource(tenantId, async (id: number | null) => {
		if (!id) {
			return null
		}
		const res = await fetch_tenant(id)
		if (Result.isError(res)) {
			setError(res.error.message)
			return null
		}
		return res.value
	})
	const groupId = createMemo(() => site()?.site_group_id ?? null)
	const [siteGroup] = createResource(groupId, async (id: number | null) => {
		if (!id) {
			return null
		}
		const res = await fetch_site_group(id)
		if (Result.isError(res)) {
			setError(res.error.message)
			return null
		}
		return res.value
	})
	const [locations, { refetch }] = createResource(
		() => props.id,
		async (id: number) => {
			const res = await fetch_locations(id)
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
			const res = await fetch_racks({ site: id })
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
			const res = await fetch_devices({ site: id })
			if (Result.isError(res)) {
				setError(res.error.message)
				return []
			}
			return res.value.items
		},
	)
	const tree = createMemo(() => buildTree(locations() ?? []))

	async function handleCreate(e: SubmitEvent): Promise<void> {
		e.preventDefault()
		setError(null)
		const res = await create_location({
			name: name(),
			slug: slug(),
			site_id: props.id,
			parent_id: parentId() ? Number(parentId()) : null,
			tenant_id: site()?.tenant_id ?? null,
		})
		if (Result.isError(res)) {
			setError(res.error.message)
			return
		}
		setName('')
		setSlug('')
		setParentId('')
		void refetch()
	}

	async function handleLocationDelete(id: number): Promise<void> {
		setError(null)
		const res = await delete_location(id)
		if (Result.isError(res)) {
			setError(res.error.message)
			return
		}
		void refetch()
	}

	async function handleDelete(): Promise<void> {
		const s = site()
		if (!s) {
			return
		}
		if (!window.confirm(`Delete site "${s.name}"?`)) {
			return
		}
		setError(null)
		const res = await delete_site(props.id)
		if (Result.isError(res)) {
			setError(res.error.message)
			return
		}
		navigate('/sites')
	}

	const locationCount = (): number => locations()?.length ?? 0
	const rackCount = (): number => racks()?.length ?? 0
	const deviceCount = (): number => devices()?.length ?? 0

	return (
		<div>
			<p>
				<a href="/sites" onClick={(e: MouseEvent): void => go(e, '/sites')}>
					← Sites
				</a>
			</p>
			<Show when={!site.loading} fallback={<p class="skeleton">Loading site…</p>}>
				<Show when={site()} fallback={<p class="empty">Site not found.</p>}>
					<div class="page-header">
						<h2>
							{site()?.name} <code>{site()?.slug}</code>
						</h2>
						<div class="form-actions">
							<button
								type="button"
								onClick={() => navigate(`/sites/${props.id}/edit`)}
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
					<p class="page-subtitle">{site()?.description || 'No description.'}</p>

					<div class="detail-stats">
						<a class="detail-stat" href="#site-locations">
							<span class="detail-stat-value">{locationCount()}</span>{' '}
							<span class="detail-stat-label">
								Location{locationCount() === 1 ? '' : 's'}
							</span>
						</a>
						<a class="detail-stat" href="#site-racks">
							<span class="detail-stat-value">{rackCount()}</span>{' '}
							<span class="detail-stat-label">
								Rack{rackCount() === 1 ? '' : 's'}
							</span>
						</a>
						<a class="detail-stat" href="#site-devices">
							<span class="detail-stat-value">{deviceCount()}</span>{' '}
							<span class="detail-stat-label">
								Device{deviceCount() === 1 ? '' : 's'}
							</span>
						</a>
					</div>

					<section class="card" aria-label="Site details">
						<dl class="detail-grid">
							<dt>Slug</dt>
							<dd>
								<code>{site()?.slug}</code>
							</dd>
							<dt>Tenant</dt>
							<dd>
								<Show when={tenantId() !== null} fallback="—">
									<Show
										when={!tenant.loading}
										fallback={<span class="skeleton">…</span>}
									>
										<Show when={tenant()} fallback={String(tenantId() ?? '—')}>
											<a
												href={`/tenants/${tenantId() ?? ''}`}
												onClick={(e: MouseEvent): void =>
													go(e, `/tenants/${tenantId() ?? ''}`)
												}
											>
												{tenant()?.name}
											</a>
										</Show>
									</Show>
								</Show>
							</dd>
							<dt>Group</dt>
							<dd>
								<Show when={groupId() !== null} fallback="—">
									<Show
										when={!siteGroup.loading}
										fallback={<span class="skeleton">…</span>}
									>
										<Show
											when={siteGroup()}
											fallback={String(groupId() ?? '—')}
										>
											<a
												href={`/site-groups/${groupId() ?? ''}`}
												onClick={(e: MouseEvent): void =>
													go(e, `/site-groups/${groupId() ?? ''}`)
												}
											>
												{siteGroup()?.name}
											</a>
										</Show>
									</Show>
								</Show>
							</dd>
							<dt>Description</dt>
							<dd>{site()?.description || '—'}</dd>
							<dt>Comments</dt>
							<dd>{(site()?.comments ?? '') || '—'}</dd>
							<dt>Physical address</dt>
							<dd>{(site()?.physical_address ?? '') || '—'}</dd>
							<dt>Shipping address</dt>
							<dd>{(site()?.shipping_address ?? '') || '—'}</dd>
						</dl>
					</section>
				</Show>
			</Show>

			<section aria-label="Locations">
				<h3 id="site-locations">
					Locations <span class="badge">{locationCount()}</span>
				</h3>
				<form onSubmit={handleCreate}>
					<input
						placeholder="Name"
						aria-label="Location name"
						value={name()}
						onInput={(e: InputEventAndTarget) => setName(e.currentTarget.value)}
					/>
					<input
						placeholder="slug"
						aria-label="Location slug"
						value={slug()}
						onInput={(e: InputEventAndTarget) => setSlug(e.currentTarget.value)}
					/>
					<select
						aria-label="Parent location"
						value={parentId()}
						onChange={(e: Event & { currentTarget: HTMLSelectElement }) =>
							setParentId(e.currentTarget.value)
						}
					>
						<option value="">Top level</option>
						<For each={locations() ?? []}>
							{(l: LocationRow): JSX.Element => (
								<option value={l.id}>{l.name}</option>
							)}
						</For>
					</select>
					<button type="submit">Add location</button>
				</form>
				<Show
					when={!locations.loading}
					fallback={<p class="skeleton">Loading locations…</p>}
				>
					<Show
						when={tree().length > 0}
						fallback={<p class="empty">No locations yet.</p>}
					>
						<ul>
							<For each={tree()}>
								{(node: TreeNode): JSX.Element => (
									<LocationBranch
										node={node}
										trail={[site()?.name ?? 'site']}
										onDelete={handleLocationDelete}
									/>
								)}
							</For>
						</ul>
					</Show>
				</Show>
			</section>

			<h3 id="site-racks">
				Racks <span class="badge">{rackCount()}</span>
			</h3>
			<Show when={!racks.loading} fallback={<p class="skeleton">Loading racks…</p>}>
				<Show
					when={rackCount() > 0}
					fallback={<p class="empty">No racks for this site yet.</p>}
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

			<h3 id="site-devices">
				Devices <span class="badge">{deviceCount()}</span>
			</h3>
			<Show when={!devices.loading} fallback={<p class="skeleton">Loading devices…</p>}>
				<Show
					when={deviceCount() > 0}
					fallback={<p class="empty">No devices for this site yet.</p>}
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

			<Show when={error()}>
				<div class="app-inline-error">{error()}</div>
			</Show>
		</div>
	)
}
