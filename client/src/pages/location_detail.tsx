import { DataTable } from '@serkonda7/solid-components'
import { IconPencil, IconTrash } from '@tabler/icons-solidjs'
import { Result } from 'better-result'
import type { JSX } from 'solid-js'
import { createMemo, createResource, createSignal, Show } from 'solid-js'
import {
	delete_location,
	fetch_location,
	fetch_locations,
	fetch_site,
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

/**
 * /locations/:id — location detail: header with slug, parent breadcrumb,
 * detail grid, and the child-locations / racks / devices tables.
 */
export function LocationDetailPage(props: { id: number }): JSX.Element {
	const [error, setError] = createSignal<string | null>(null)

	const [location] = createResource(
		() => props.id,
		async (id: number) => {
			setError(null)
			const res = await fetch_location(id)
			if (Result.isError(res)) {
				setError(res.error.message)
				return null
			}
			return res.value
		},
	)
	const siteId = createMemo(() => location()?.site_id ?? null)
	const [site] = createResource(siteId, async (id: number | null) => {
		if (!id) {
			return null
		}
		const res = await fetch_site(id)
		if (Result.isError(res)) {
			setError(res.error.message)
			return null
		}
		return res.value
	})
	const parentId = createMemo(() => location()?.parent_id ?? null)
	const [parent] = createResource(parentId, async (id: number | null) => {
		if (!id) {
			return null
		}
		const res = await fetch_location(id)
		if (Result.isError(res)) {
			setError(res.error.message)
			return null
		}
		return res.value
	})
	const tenantId = createMemo(() => location()?.tenant_id ?? null)
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
	const [children] = createResource(
		() => props.id,
		async (id: number) => {
			const res = await fetch_locations({ parent: id })
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
			const res = await fetch_racks({ location: id })
			if (Result.isError(res)) {
				setError(res.error.message)
				return []
			}
			return res.value.items
		},
	)
	// Devices have no location filter on the API, so scope by site and
	// narrow to this location client-side.
	const [devices] = createResource(
		() => ({ site: siteId(), location: props.id }),
		async ({ site: siteKey, location: locationKey }) => {
			if (!siteKey) {
				return []
			}
			const res = await fetch_devices({ site: siteKey })
			if (Result.isError(res)) {
				setError(res.error.message)
				return []
			}
			return res.value.items.filter((d) => d.location_id === locationKey)
		},
	)

	async function handleDelete(): Promise<void> {
		const l = location()
		if (!l) {
			return
		}
		if (!window.confirm(`Delete location "${l.name}"?`)) {
			return
		}
		setError(null)
		const res = await delete_location(props.id)
		if (Result.isError(res)) {
			setError(res.error.message)
			return
		}
		navigate('/locations')
	}

	const childCount = (): number => children()?.length ?? 0
	const rackCount = (): number => racks()?.length ?? 0
	const deviceCount = (): number => devices()?.length ?? 0

	return (
		<div>
			<p>
				<a href="/locations" onClick={(e: MouseEvent): void => go(e, '/locations')}>
					← Locations
				</a>
			</p>
			<Show when={!location.loading} fallback={<p class="skeleton">Loading location…</p>}>
				<Show when={location()} fallback={<p class="empty">Location not found.</p>}>
					<Show when={parentId() !== null}>
						<p class="page-subtitle">
							<a
								href={`/locations/${parentId() ?? ''}`}
								onClick={(e: MouseEvent): void =>
									go(e, `/locations/${parentId() ?? ''}`)
								}
							>
								{parent()?.name ?? `Location ${parentId() ?? ''}`}
							</a>{' '}
							/ {location()?.name}
						</p>
					</Show>
					<div class="page-header">
						<h2>
							{location()?.name} <code>{location()?.slug}</code>
						</h2>
						<div class="form-actions">
							<button
								type="button"
								onClick={() => navigate(`/locations/${props.id}/edit`)}
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
					<p class="page-subtitle">{location()?.description || 'No description.'}</p>

					<section class="card" aria-label="Location details">
						<dl class="detail-grid">
							<dt>Slug</dt>
							<dd>
								<code>{location()?.slug}</code>
							</dd>
							<dt>Site</dt>
							<dd>
								<Show when={siteId() !== null} fallback="—">
									<Show
										when={!site.loading}
										fallback={<span class="skeleton">…</span>}
									>
										<Show when={site()} fallback={String(siteId() ?? '—')}>
											<a
												href={`/sites/${siteId() ?? ''}`}
												onClick={(e: MouseEvent): void =>
													go(e, `/sites/${siteId() ?? ''}`)
												}
											>
												{site()?.name}
											</a>
										</Show>
									</Show>
								</Show>
							</dd>
							<dt>Parent</dt>
							<dd>
								<Show when={parentId() !== null} fallback="—">
									<Show
										when={!parent.loading}
										fallback={<span class="skeleton">…</span>}
									>
										<Show when={parent()} fallback={String(parentId() ?? '—')}>
											<a
												href={`/locations/${parentId() ?? ''}`}
												onClick={(e: MouseEvent): void =>
													go(e, `/locations/${parentId() ?? ''}`)
												}
											>
												{parent()?.name}
											</a>
										</Show>
									</Show>
								</Show>
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
							<dt>Description</dt>
							<dd>{location()?.description || '—'}</dd>
						</dl>
					</section>
				</Show>
			</Show>

			<h3 id="location-children">
				Child locations <span class="badge">{childCount()}</span>
			</h3>
			<Show
				when={!children.loading}
				fallback={<p class="skeleton">Loading child locations…</p>}
			>
				<Show
					when={childCount() > 0}
					fallback={<p class="empty">No child locations yet.</p>}
				>
					<DataTable
						rows={() => children() ?? []}
						getRowId={(l: LocationRow): number => l.id}
						columns={[
							{
								key: 'name',
								label: 'Name',
								getValue: (l: LocationRow): JSX.Element => (
									<a
										href={`/locations/${l.id}`}
										onClick={(e: MouseEvent): void =>
											go(e, `/locations/${l.id}`)
										}
									>
										{l.name}
									</a>
								),
							},
							{
								key: 'slug',
								label: 'Slug',
								getValue: (l: LocationRow): JSX.Element => <code>{l.slug}</code>,
							},
						]}
					/>
				</Show>
			</Show>

			<h3 id="location-racks">
				Racks <span class="badge">{rackCount()}</span>
			</h3>
			<Show when={!racks.loading} fallback={<p class="skeleton">Loading racks…</p>}>
				<Show when={rackCount() > 0} fallback={<p class="empty">No racks here yet.</p>}>
					<DataTable
						rows={() => racks() ?? []}
						getRowId={(r: RackRow): number => r.id}
						columns={[
							{
								key: 'name',
								label: 'Name',
								getValue: (r: RackRow): JSX.Element => (
									<a
										href={`/racks/${r.id}`}
										onClick={(e: MouseEvent): void => go(e, `/racks/${r.id}`)}
									>
										{r.name}
									</a>
								),
							},
							{
								key: 'height',
								label: 'Height',
								getValue: (r: RackRow): string => `${r.height_u}U`,
							},
							{
								key: 'status',
								label: 'Status',
								getValue: (r: RackRow): JSX.Element => (
									<span class={`badge badge-${r.status}`}>{r.status}</span>
								),
							},
						]}
					/>
				</Show>
			</Show>

			<h3 id="location-devices">
				Devices <span class="badge">{deviceCount()}</span>
			</h3>
			<Show when={!devices.loading} fallback={<p class="skeleton">Loading devices…</p>}>
				<Show when={deviceCount() > 0} fallback={<p class="empty">No devices here yet.</p>}>
					<DataTable
						rows={() => devices() ?? []}
						getRowId={(d: DeviceRow): number => d.id}
						columns={[
							{
								key: 'name',
								label: 'Name',
								getValue: (d: DeviceRow): JSX.Element => (
									<a
										href={`/devices/${d.id}`}
										onClick={(e: MouseEvent): void => go(e, `/devices/${d.id}`)}
									>
										{d.name}
									</a>
								),
							},
							{
								key: 'status',
								label: 'Status',
								getValue: (d: DeviceRow): JSX.Element => (
									<span class={`badge badge-${d.status}`}>{d.status}</span>
								),
							},
						]}
					/>
				</Show>
			</Show>

			<Show when={error()}>
				<div class="app-inline-error">{error()}</div>
			</Show>
		</div>
	)
}
