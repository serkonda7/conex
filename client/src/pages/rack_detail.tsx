import { DataTable } from '@serkonda7/solid-components'
import { IconPencil, IconTrash } from '@tabler/icons-solidjs'
import { Result } from 'better-result'
import type { ElevationUnit, InputEventAndTarget } from 'shared/src/types'
import type { JSX } from 'solid-js'
import { createMemo, createResource, createSignal, Show } from 'solid-js'
import { fetch_location, fetch_site, fetch_tenant } from '../api_p1'
import { create_shelf, delete_rack, delete_shelf, fetch_elevation, fetch_rack } from '../api_p2'
import { navigate } from '../router'

function go(e: MouseEvent, to: string): void {
	e.preventDefault()
	navigate(to)
}

/**
 * /racks/:id — rack detail: header with name/slug/description, detail
 * grid (site, location, type placeholder, tenant), related-device counts
 * via the elevation, and the top-down elevation with shelf management.
 */
export function RackDetailPage(props: { id: number }): JSX.Element {
	const [error, setError] = createSignal<string | null>(null)
	const [shelfName, setShelfName] = createSignal('')
	const [shelfU, setShelfU] = createSignal('')
	const [pendingU, setPendingU] = createSignal<number | null>(null)

	const [rack] = createResource(
		() => props.id,
		async (id: number) => {
			const res = await fetch_rack(id)
			if (Result.isError(res)) {
				setError(res.error.message)
				return null
			}
			return res.value
		},
	)
	const siteId = createMemo(() => rack()?.site_id ?? null)
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
	const locationId = createMemo(() => rack()?.location_id ?? null)
	const [location] = createResource(locationId, async (id: number | null) => {
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
	const tenantId = createMemo(() => rack()?.tenant_id ?? null)
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
	const [elevation, { refetch }] = createResource(
		() => props.id,
		async (id: number) => {
			const res = await fetch_elevation(id)
			if (Result.isError(res)) {
				setError(res.error.message)
				return null
			}
			return res.value
		},
	)

	async function handleDelete(): Promise<void> {
		const r = rack()
		if (!r) {
			return
		}
		if (!window.confirm(`Delete rack "${r.name}"?`)) {
			return
		}
		setError(null)
		const res = await delete_rack(props.id)
		if (Result.isError(res)) {
			setError(res.error.message)
			return
		}
		navigate('/racks')
	}

	async function handleCreateShelf(e: SubmitEvent): Promise<void> {
		e.preventDefault()
		setError(null)
		const position = Number(shelfU())
		if (!Number.isInteger(position) || position < 1) {
			setError('Shelf position must be a positive U number')
			return
		}
		const res = await create_shelf({
			name: shelfName(),
			rack_id: props.id,
			position_u: position,
		})
		if (Result.isError(res)) {
			setError(res.error.message)
			return
		}
		setShelfName('')
		setShelfU('')
		setPendingU(null)
		void refetch()
	}

	async function handleDeleteShelf(id: number): Promise<void> {
		setError(null)
		const res = await delete_shelf(id)
		if (Result.isError(res)) {
			setError(res.error.message)
			return
		}
		void refetch()
	}

	return (
		<div>
			<p>
				<a href="/racks" onClick={(e: MouseEvent): void => go(e, '/racks')}>
					← Racks
				</a>
			</p>
			<Show when={!rack.loading} fallback={<p class="skeleton">Loading rack…</p>}>
				<Show when={rack()} fallback={<p class="empty">Rack not found.</p>}>
					<div class="page-header">
						<h2>
							{rack()?.name} <code>{rack()?.slug}</code>{' '}
							<span>{rack()?.height_u}U</span>
						</h2>
						<div class="form-actions">
							<button
								type="button"
								onClick={() => navigate(`/racks/${props.id}/edit`)}
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
					<p class="page-subtitle">{rack()?.description || 'No description.'}</p>

					<section class="card" aria-label="Rack details">
						<dl class="detail-grid">
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
							<dt>Location</dt>
							<dd>
								<Show when={locationId() !== null} fallback="—">
									<Show
										when={!location.loading}
										fallback={<span class="skeleton">…</span>}
									>
										<Show
											when={location()}
											fallback={String(locationId() ?? '—')}
										>
											<a
												href={`/locations/${locationId() ?? ''}`}
												onClick={(e: MouseEvent): void =>
													go(e, `/locations/${locationId() ?? ''}`)
												}
											>
												{location()?.name}
											</a>
										</Show>
									</Show>
								</Show>
							</dd>
							<dt>Description</dt>
							<dd>{rack()?.description || '—'}</dd>
							<dt>Rack type</dt>
							<dd title="Rack types coming soon">—</dd>
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
							<dt>Status</dt>
							<dd>{rack()?.status ?? '—'}</dd>
						</dl>
					</section>
				</Show>
			</Show>
			<h3>Add shelf</h3>
			<form onSubmit={handleCreateShelf}>
				<input
					placeholder="Name"
					aria-label="Shelf name"
					value={shelfName()}
					onInput={(e: InputEventAndTarget) => setShelfName(e.currentTarget.value)}
				/>
				<input
					placeholder="U position"
					aria-label="Shelf U position"
					inputmode="numeric"
					value={shelfU()}
					onInput={(e: InputEventAndTarget) => setShelfU(e.currentTarget.value)}
				/>
				<button type="submit">Add shelf</button>
			</form>
			<h3>Elevation</h3>
			<p class="page-subtitle">Top-down elevation. Pick a free U to place a device.</p>
			<Show when={elevation()} fallback={<p class="skeleton">Loading elevation…</p>}>
				<DataTable
					rows={() => elevation()?.units ?? []}
					getRowId={(unit: ElevationUnit) => unit.u}
					showColumnCustomizer
					columns={[
						{
							key: 'u',
							label: 'U',
							getValue: (unit: ElevationUnit) => <code>U{unit.u}</code>,
						},
						{
							key: 'occupant',
							label: 'Occupant',
							getValue: (unit: ElevationUnit) => (
								<span>
									<Show when={unit.shelf} fallback={<span>free</span>}>
										<span>▤ {unit.shelf?.name} (shelf)</span>
									</Show>{' '}
									<Show when={unit.device}>
										<span>
											▦{' '}
											<a
												href={`/devices/${unit.device?.id}`}
												onClick={(e: MouseEvent): void =>
													go(e, `/devices/${unit.device?.id ?? ''}`)
												}
											>
												{unit.device?.name}
											</a>
										</span>
									</Show>
								</span>
							),
						},
					]}
					rowActions={(unit: ElevationUnit) => (
						<Show
							when={unit.shelf}
							fallback={
								<button
									type="button"
									title="Pick a U below, then instantiate from Devices"
									onClick={() => {
										setPendingU(unit.u)
										setShelfU(String(unit.u))
									}}
								>
									Place here
								</button>
							}
						>
							<button
								type="button"
								class="btn-danger"
								onClick={() => {
									if (unit.shelf) {
										handleDeleteShelf(unit.shelf.id)
									}
								}}
							>
								Delete shelf
							</button>
						</Show>
					)}
				/>
			</Show>
			<Show when={pendingU() !== null}>
				<p class="empty">
					U{pendingU()} selected — instantiate the device from{' '}
					<a href="/devices" onClick={(e: MouseEvent): void => go(e, '/devices')}>
						Devices
					</a>{' '}
					with this rack and U position.
				</p>
			</Show>
			<Show when={error()}>
				<div class="app-inline-error">{error()}</div>
			</Show>
		</div>
	)
}
