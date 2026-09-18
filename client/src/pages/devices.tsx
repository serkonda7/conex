import { Result } from 'better-result'
import type { InputEventAndTarget } from 'shared/src/types'
import type { JSX } from 'solid-js'
import { createResource, createSignal, For, Show } from 'solid-js'
import { fetch_racks, type RackRow } from '../api_p2'
import { type DeviceTypeRow, fetch_device_types } from '../api_p3'
import { create_device, type DeviceRow, delete_device, fetch_devices } from '../api_p4'
import { navigate } from '../router'

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
	const [name, setName] = createSignal('')
	const [typeId, setTypeId] = createSignal('')
	const [rackId, setRackId] = createSignal('')
	const [positionU, setPositionU] = createSignal('')
	const [shelfId, setShelfId] = createSignal('')

	const [devices, { refetch }] = createResource(async () => {
		const res = await fetch_devices({
			search: search(),
			status: (status() || undefined) as
				| 'active'
				| 'planned'
				| 'staged'
				| 'decommissioned'
				| undefined,
			rack: rackFilter() || undefined,
		})
		if (Result.isError(res)) {
			setError(res.error.message)
			return []
		}
		return res.value.items
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

	function typeNameOf(id: string): string {
		return types()?.find((t) => t.id === id)?.model ?? id.slice(0, 8)
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
			device_type_id: typeId(),
			name: name(),
			rack_id: rackId() === '' ? null : rackId(),
			position_u: position,
			shelf_id: shelfId().trim() === '' ? null : shelfId().trim(),
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
				<input
					placeholder="Search name, asset tag, serial…"
					value={search()}
					onInput={(e: InputEventAndTarget) => setSearch(e.currentTarget.value)}
				/>
				<select
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
				<select
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
								<td>{d.status}</td>
								<td>
									{d.shelf_id ? (
										<code>shelf:{d.shelf_id.slice(0, 8)}</code>
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
			<Show when={error()}>
				<div class="app-inline-error">{error()}</div>
			</Show>
		</div>
	)
}
