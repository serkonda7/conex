import { IconPencil, IconTrash } from '@tabler/icons-solidjs'
import { Result } from 'better-result'
import type { InputEventAndTarget } from 'shared/src/types'
import type { JSX } from 'solid-js'
import { createMemo, createResource, createSignal, Show } from 'solid-js'
import { fetch_location, fetch_site, fetch_tenant } from '../api_p1'
import { create_shelf, delete_rack, delete_shelf, fetch_elevation, fetch_rack } from '../api_p2'
import { fetch_device_type } from '../api_p3'
import { type DeviceRow, fetch_devices, update_device } from '../api_p4'
import { ObjectSelector } from '../components/object_selector'
import { RackElevation, type RackFace } from '../components/rack_elevation'
import { navigate } from '../router'

function go(e: MouseEvent, to: string): void {
	e.preventDefault()
	navigate(to)
}

/**
 * /racks/:id — rack detail: header with name/description, two-column
 * layout (details left, elevation right) with a utilization strip and the
 * NetBox-like visual elevation (front/rear faces, spanning multi-U blocks,
 * click-free-U to install) with shelf management.
 */
export function RackDetailPage(props: { id: number }): JSX.Element {
	const [error, setError] = createSignal<string | null>(null)
	const [shelfName, setShelfName] = createSignal('')
	const [shelfU, setShelfU] = createSignal('')
	const [shelfH, setShelfH] = createSignal('1')
	const [pendingU, setPendingU] = createSignal<number | null>(null)
	const [face, setFace] = createSignal<RackFace>('front')
	const [selectingDevice, setSelectingDevice] = createSignal(false)

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
	const rackTypeId = createMemo(() => rack()?.rack_type_id ?? null)
	const [rackType] = createResource(rackTypeId, async (id: number | null) => {
		if (!id) {
			return null
		}
		const res = await fetch_device_type(id)
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

	const occupiedU = createMemo(
		() => elevation()?.units.filter((u) => u.shelf !== null || u.device !== null).length ?? 0,
	)
	/** Rack height is owned by the rack type; the stored rack row is only a fallback. */
	const displayHeight = createMemo(
		() => elevation()?.height_u ?? rackType()?.u_height ?? rack()?.height_u ?? 0,
	)
	const totalU = displayHeight
	const utilPct = createMemo(() =>
		totalU() > 0 ? Math.round((occupiedU() / totalU()) * 100) : 0,
	)
	const deviceCount = createMemo(
		() =>
			new Set((elevation()?.units ?? []).flatMap((u) => (u.device ? [u.device.id] : [])))
				.size,
	)
	const shelfCount = createMemo(
		() =>
			new Set((elevation()?.units ?? []).flatMap((u) => (u.shelf ? [u.shelf.id] : []))).size,
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
		navigate('/racks', { refresh: true })
	}

	async function handleCreateShelf(e: SubmitEvent): Promise<void> {
		e.preventDefault()
		setError(null)
		const position = Number(shelfU())
		if (!Number.isInteger(position) || position < 1) {
			setError('Shelf position must be a positive U number')
			return
		}
		const height = shelfH().trim() === '' ? 1 : Number(shelfH())
		if (!Number.isInteger(height) || height < 1) {
			setError('Shelf height must be a positive U number')
			return
		}
		const res = await create_shelf({
			name: shelfName(),
			rack_id: props.id,
			position_u: position,
			height_u: height,
		})
		if (Result.isError(res)) {
			setError(res.error.message)
			return
		}
		setShelfName('')
		setShelfU('')
		setShelfH('1')
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

	function pickU(u: number, pickedFace: RackFace): void {
		setPendingU(u)
		setFace(pickedFace)
		setShelfU(String(u))
	}

	function installDevice(u: number, targetFace: RackFace = face()): void {
		navigate(`/devices/add?rack=${props.id}&position_u=${u}&face=${targetFace}`)
	}

	function openDeviceSelector(u: number, targetFace: RackFace): void {
		pickU(u, targetFace)
		setSelectingDevice(true)
	}

	async function placeDevice(device: DeviceRow): Promise<void> {
		const u = pendingU()
		if (u === null) {
			return
		}
		setSelectingDevice(false)
		setError(null)
		const result = await update_device(device.id, {
			rack_id: props.id,
			position_u: u,
			shelf_id: null,
			face: face(),
		})
		if (Result.isError(result)) {
			setError(result.error.message)
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
							{rack()?.name} <span>{displayHeight()}U</span>
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

					<div class="detail-columns">
						<div>
							<section class="card" aria-label="Rack details">
								<dl class="detail-grid">
									<dt>Site</dt>
									<dd>
										<Show when={siteId() !== null} fallback="—">
											<Show
												when={!site.loading}
												fallback={<span class="skeleton">…</span>}
											>
												<Show
													when={site()}
													fallback={String(siteId() ?? '—')}
												>
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
															go(
																e,
																`/locations/${locationId() ?? ''}`,
															)
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
									<dd>
										<Show when={rackTypeId() !== null} fallback="—">
											<Show
												when={!rackType.loading}
												fallback={<span class="skeleton">…</span>}
											>
												{rackType()?.model ?? String(rackTypeId() ?? '—')}
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
												<Show
													when={tenant()}
													fallback={String(tenantId() ?? '—')}
												>
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
								</dl>
							</section>

							<div class="detail-stats">
								<span class="detail-stat">
									<span class="detail-stat-value">{deviceCount()}</span>{' '}
									<span class="detail-stat-label">
										Device{deviceCount() === 1 ? '' : 's'}
									</span>
								</span>
								<span class="detail-stat">
									<span class="detail-stat-value">{shelfCount()}</span>{' '}
									<span class="detail-stat-label">
										Shel{shelfCount() === 1 ? 'f' : 'ves'}
									</span>
								</span>
								<span class="detail-stat">
									<span class="detail-stat-value">
										{occupiedU()}/{totalU()}U
									</span>{' '}
									<span class="detail-stat-label">Used ({utilPct()}%)</span>
								</span>
							</div>
						</div>

						<div>
							<div
								class="rack-util"
								role="status"
								aria-label={`${occupiedU()} of ${totalU()}U used`}
							>
								<span>
									{occupiedU()}/{totalU()}U · {utilPct()}% used
								</span>
								<span class="rack-util-bar" aria-hidden="true">
									<span
										class="rack-util-fill"
										style={{ width: `${utilPct()}%` }}
									/>
								</span>
							</div>
							<Show
								when={elevation()}
								fallback={<p class="skeleton">Loading elevation…</p>}
							>
								<RackElevation
									units={elevation()?.units ?? []}
									selected_u={pendingU()}
									selected_face={face()}
									on_select_u={pickU}
									on_select_device={openDeviceSelector}
									on_add_device={installDevice}
									on_delete_shelf={(id: number) => void handleDeleteShelf(id)}
								/>
							</Show>
							<Show when={selectingDevice()}>
								<ObjectSelector
									label={`Select device for U${pendingU() ?? ''} (${face()} face)`}
									placeholder="Search devices…"
									load={async (search: string) => {
										const result = await fetch_devices({ search })
										return Result.isError(result)
											? Result.err(result.error)
											: Result.ok(result.value.items)
									}}
									get_label={(device: DeviceRow) => device.name}
									on_select={(device: DeviceRow) => void placeDevice(device)}
									on_close={() => setSelectingDevice(false)}
								/>
							</Show>

							<h3>Add shelf</h3>
							<form onSubmit={handleCreateShelf}>
								<input
									placeholder="Name"
									aria-label="Shelf name"
									value={shelfName()}
									onInput={(e: InputEventAndTarget) =>
										setShelfName(e.currentTarget.value)
									}
								/>
								<input
									placeholder="U position"
									aria-label="Shelf U position"
									inputmode="numeric"
									value={shelfU()}
									onInput={(e: InputEventAndTarget) =>
										setShelfU(e.currentTarget.value)
									}
								/>
								<input
									placeholder="Height (U)"
									aria-label="Shelf height in U"
									inputmode="numeric"
									value={shelfH()}
									onInput={(e: InputEventAndTarget) =>
										setShelfH(e.currentTarget.value)
									}
								/>
								<button type="submit">Add shelf</button>
							</form>
						</div>
					</div>
				</Show>
			</Show>

			<Show when={error()}>
				<div class="app-inline-error">{error()}</div>
			</Show>
		</div>
	)
}
