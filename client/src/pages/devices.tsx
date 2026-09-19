import { Result } from 'better-result'
import type { InputEventAndTarget } from 'shared/src/types'
import type { JSX } from 'solid-js'
import { createEffect, createResource, createSignal, For, Show } from 'solid-js'
import { fetch_tenants, type TenantRow } from '../api_p1'
import { fetch_racks, type RackRow } from '../api_p2'
import { type DeviceTypeRow, fetch_device_types } from '../api_p3'
import { create_device, type DeviceRow, delete_device, fetch_devices } from '../api_p4'
import { download_csv, type ImportResponse, upload_csv } from '../api_p6'
import { navigate, parseId, queryParam } from '../router'

function go(e: MouseEvent, to: string): void {
	e.preventDefault()
	navigate(to)
}

/**
 * /devices — filterable device table (search + site/rack/tenant/status) with
 * a minimal instantiate form: pick a template, a name, and optionally a rack
 * position or a shelf. Stub expansion happens server-side on create.
 */
export function DevicesPage(): JSX.Element {
	const [error, setError] = createSignal<string | null>(null)
	const [search, setSearch] = createSignal('')
	const [status, setStatus] = createSignal('')
	const [rackFilter, setRackFilter] = createSignal('')
	const [tenantFilter, setTenantFilter] = createSignal(queryParam('tenant'))
	const [name, setName] = createSignal('')
	const [typeId, setTypeId] = createSignal('')
	const [rackId, setRackId] = createSignal('')
	const [positionU, setPositionU] = createSignal('')
	const [shelfId, setShelfId] = createSignal('')
	const [importSummary, setImportSummary] = createSignal<string | null>(null)
	const [importErrors, setImportErrors] = createSignal<string[]>([])

	const [devices, { refetch }] = createResource(async () => {
		const res = await fetch_devices({
			search: search(),
			status: (status() || undefined) as
				| 'active'
				| 'planned'
				| 'staged'
				| 'decommissioned'
				| undefined,
			rack: rackFilter() ? (parseId(rackFilter()) ?? undefined) : undefined,
			tenant: tenantFilter() ? (parseId(tenantFilter()) ?? undefined) : undefined,
		})
		if (Result.isError(res)) {
			setError(res.error.message)
			return []
		}
		return res.value.items
	})
	// Follow tenant links from the tenants table (`/devices?tenant=<id>`).
	createEffect(() => {
		const fromUrl = queryParam('tenant')
		if (fromUrl !== tenantFilter()) {
			setTenantFilter(fromUrl)
			void refetch()
		}
	})
	const [types] = createResource(async () => {
		const res = await fetch_device_types()
		if (Result.isError(res)) {
			setError(res.error.message)
			return []
		}
		return res.value.items
	})
	const [racks] = createResource(async () => {
		const res = await fetch_racks()
		if (Result.isError(res)) {
			setError(res.error.message)
			return []
		}
		return res.value.items
	})
	const [tenants] = createResource(async () => {
		const res = await fetch_tenants()
		if (Result.isError(res)) {
			setError(res.error.message)
			return []
		}
		return res.value.items
	})

	function typeNameOf(id: number): string {
		return types()?.find((t) => t.id === id)?.model ?? String(id)
	}

	async function handleImport(kind: 'devices' | 'cables', file: File | undefined): Promise<void> {
		setError(null)
		setImportSummary(null)
		setImportErrors([])
		if (!file) {
			return
		}
		const res = await upload_csv(kind, await file.text())
		if (Result.isError(res)) {
			setError(res.error.message)
			return
		}
		const outcome: ImportResponse = res.value
		setImportSummary(`${kind} import: ${outcome.created} created, ${outcome.failed} failed`)
		setImportErrors(
			outcome.rows.filter((r) => !r.ok).map((r) => `Row ${r.row}: ${r.error ?? 'failed'}`),
		)
		void refetch()
	}

	async function handleCreate(e: SubmitEvent): Promise<void> {
		e.preventDefault()
		setError(null)
		if (!typeId()) {
			setError('Select a device type first')
			return
		}
		const position = positionU().trim() === '' ? null : Number(positionU())
		if (position !== null && (!Number.isInteger(position) || position < 1)) {
			setError('Rack position must be a positive U number or empty')
			return
		}
		const res = await create_device({
			device_type_id: Number(typeId()),
			name: name(),
			rack_id: rackId() === '' ? null : Number(rackId()),
			position_u: position,
			shelf_id: shelfId().trim() === '' ? null : Number(shelfId().trim()),
		})
		if (Result.isError(res)) {
			setError(res.error.message)
			return
		}
		setName('')
		setPositionU('')
		setShelfId('')
		void refetch()
	}

	return (
		<div>
			<h2>Devices</h2>
			<form
				onSubmit={(e: SubmitEvent): void => {
					e.preventDefault()
					setError(null)
					void refetch()
				}}
			>
				<label class="visually-hidden" for="devices-search">
					Search devices
				</label>
				<input
					id="devices-search"
					placeholder="Search name, asset tag, serial…"
					aria-label="Search devices"
					value={search()}
					onInput={(e: InputEventAndTarget) => setSearch(e.currentTarget.value)}
				/>
				<label class="visually-hidden" for="devices-status">
					Status filter
				</label>
				<select
					id="devices-status"
					aria-label="Status filter"
					value={status()}
					onChange={(e: Event & { currentTarget: HTMLSelectElement }) =>
						setStatus(e.currentTarget.value)
					}
				>
					<option value="">Any status</option>
					<option value="active">active</option>
					<option value="planned">planned</option>
					<option value="staged">staged</option>
					<option value="decommissioned">decommissioned</option>
				</select>
				<label class="visually-hidden" for="devices-rack">
					Rack filter
				</label>
				<select
					id="devices-rack"
					aria-label="Rack filter"
					value={rackFilter()}
					onChange={(e: Event & { currentTarget: HTMLSelectElement }) =>
						setRackFilter(e.currentTarget.value)
					}
				>
					<option value="">Any rack</option>
					<For each={racks() ?? []}>
						{(r: RackRow): JSX.Element => <option value={r.id}>{r.name}</option>}
					</For>
				</select>
				<label class="visually-hidden" for="devices-tenant">
					Tenant filter
				</label>
				<select
					id="devices-tenant"
					aria-label="Tenant filter"
					value={tenantFilter()}
					onChange={(e: Event & { currentTarget: HTMLSelectElement }) =>
						setTenantFilter(e.currentTarget.value)
					}
				>
					<option value="">Any tenant</option>
					<For each={tenants() ?? []}>
						{(t: TenantRow): JSX.Element => <option value={t.id}>{t.name}</option>}
					</For>
				</select>
				<button type="submit">Filter</button>
			</form>

			<h3>Instantiate device</h3>
			<form onSubmit={handleCreate}>
				<input
					placeholder="Name"
					value={name()}
					onInput={(e: InputEventAndTarget) => setName(e.currentTarget.value)}
				/>
				<select
					value={typeId()}
					onChange={(e: Event & { currentTarget: HTMLSelectElement }) =>
						setTypeId(e.currentTarget.value)
					}
				>
					<option value="">Device type…</option>
					<For each={types() ?? []}>
						{(t: DeviceTypeRow): JSX.Element => (
							<option value={t.id}>
								{t.model} ({t.u_height}U)
							</option>
						)}
					</For>
				</select>
				<select
					value={rackId()}
					onChange={(e: Event & { currentTarget: HTMLSelectElement }) =>
						setRackId(e.currentTarget.value)
					}
				>
					<option value="">Unracked</option>
					<For each={racks() ?? []}>
						{(r: RackRow): JSX.Element => <option value={r.id}>{r.name}</option>}
					</For>
				</select>
				<input
					placeholder="U position (or empty)"
					inputmode="numeric"
					value={positionU()}
					onInput={(e: InputEventAndTarget) => setPositionU(e.currentTarget.value)}
				/>
				<input
					placeholder="Shelf id (or empty)"
					value={shelfId()}
					onInput={(e: InputEventAndTarget) => setShelfId(e.currentTarget.value)}
				/>
				<button type="submit">Create device</button>
			</form>

			<h3>Import / export</h3>
			<p>
				<button
					type="button"
					onClick={async () => {
						setError(null)
						const res = await download_csv('devices')
						if (Result.isError(res)) {
							setError(res.error.message)
						}
					}}
				>
					Export devices CSV
				</button>{' '}
				<button
					type="button"
					onClick={async () => {
						setError(null)
						const res = await download_csv('cables')
						if (Result.isError(res)) {
							setError(res.error.message)
						}
					}}
				>
					Export cables CSV
				</button>
			</p>
			<p>
				<label>
					Import devices CSV:{' '}
					<input
						type="file"
						accept=".csv,text/csv"
						onChange={(e: Event & { currentTarget: HTMLInputElement }) => {
							void handleImport('devices', e.currentTarget.files?.[0])
							e.currentTarget.value = ''
						}}
					/>
				</label>
			</p>
			<p>
				<label>
					Import cables CSV:{' '}
					<input
						type="file"
						accept=".csv,text/csv"
						onChange={(e: Event & { currentTarget: HTMLInputElement }) => {
							void handleImport('cables', e.currentTarget.files?.[0])
							e.currentTarget.value = ''
						}}
					/>
				</label>
			</p>
			<Show when={importSummary()}>
				<p>{importSummary()}</p>
			</Show>
			<Show when={importErrors().length > 0}>
				<ul>
					<For each={importErrors()}>{(msg: string): JSX.Element => <li>{msg}</li>}</For>
				</ul>
			</Show>

			<table>
				<thead>
					<tr>
						<th>Name</th>
						<th>Type</th>
						<th>Status</th>
						<th>Mount</th>
						<th>Asset tag</th>
						<th>Actions</th>
					</tr>
				</thead>
				<tbody>
					<For each={devices() ?? []}>
						{(d: DeviceRow): JSX.Element => (
							<tr>
								<td>
									<a
										href={`/devices/${d.id}`}
										onClick={(e: MouseEvent): void => go(e, `/devices/${d.id}`)}
									>
										{d.name}
									</a>
								</td>
								<td>{typeNameOf(d.device_type_id)}</td>
								<td>
									<span class={`badge badge-${d.status}`}>{d.status}</span>
								</td>
								<td>
									{d.shelf_id ? (
										<code>shelf:{d.shelf_id}</code>
									) : d.position_u !== null ? (
										<code>U{d.position_u}</code>
									) : (
										<span>unracked</span>
									)}
								</td>
								<td>{d.asset_tag ?? '—'}</td>
								<td>
									<button
										type="button"
										class="btn-danger"
										onClick={async () => {
											setError(null)
											const res = await delete_device(d.id)
											if (Result.isError(res)) {
												setError(res.error.message)
												return
											}
											void refetch()
										}}
									>
										Delete
									</button>
								</td>
							</tr>
						)}
					</For>
				</tbody>
			</table>
			<Show when={!devices.loading && (devices() ?? []).length === 0}>
				<p class="empty">No devices match. Adjust the filters or instantiate one above.</p>
			</Show>
			<Show when={devices.loading}>
				<p class="skeleton">Loading devices…</p>
			</Show>
			<Show when={error()}>
				<div class="app-inline-error">{error()}</div>
			</Show>
		</div>
	)
}
