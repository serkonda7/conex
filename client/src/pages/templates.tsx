import { Result } from 'better-result'
import type { InputEventAndTarget } from 'shared/src/types'
import type { JSX } from 'solid-js'
import { createResource, createSignal, For, Show } from 'solid-js'
import {
	create_device_type,
	create_manufacturer,
	create_stub,
	type DeviceTypeRow,
	delete_device_type,
	delete_manufacturer,
	delete_stub,
	fetch_adhoc_preview,
	fetch_device_types,
	fetch_manufacturers,
	fetch_stubs,
	fetch_type_preview,
	type ManufacturerRow,
	type StubRow,
} from '../api_p3'

/**
 * /templates — manufacturer + device-type editor with stub preview.
 * The left column manages manufacturers; picking a device type shows its
 * stub rows plus the expanded interface-name preview (`eth0..eth23`).
 */
export function TemplatesPage(): JSX.Element {
	const [error, setError] = createSignal<string | null>(null)
	const [mfrName, setMfrName] = createSignal('')
	const [mfrSlug, setMfrSlug] = createSignal('')
	const [mfrDescription, setMfrDescription] = createSignal('')
	const [typeModel, setTypeModel] = createSignal('')
	const [typeSlug, setTypeSlug] = createSignal('')
	const [typeHeight, setTypeHeight] = createSignal('1')
	const [typeMfr, setTypeMfr] = createSignal('')
	const [stubPrefix, setStubPrefix] = createSignal('')
	const [stubCount, setStubCount] = createSignal('24')
	const [previewNames, setPreviewNames] = createSignal<string[]>([])
	const [selectedType, setSelectedType] = createSignal<number | null>(null)

	const [manufacturers, { refetch: refetchMfrs }] = createResource(async () => {
		const res = await fetch_manufacturers()
		if (Result.isError(res)) {
			setError(res.error.message)
			return []
		}
		return res.value.items
	})
	const [types, { refetch: refetchTypes }] = createResource(async () => {
		const res = await fetch_device_types()
		if (Result.isError(res)) {
			setError(res.error.message)
			return []
		}
		return res.value.items
	})
	const [stubs, { refetch: refetchStubs }] = createResource(async () => {
		const typeId = selectedType()
		if (typeId === null) {
			return []
		}
		const res = await fetch_stubs(typeId)
		if (Result.isError(res)) {
			setError(res.error.message)
			return []
		}
		return res.value
	})

	function mfrNameOf(id: number): string {
		return manufacturers()?.find((m) => m.id === id)?.name ?? String(id)
	}

	async function refreshPreview(typeId: number): Promise<void> {
		const res = await fetch_type_preview(typeId)
		if (Result.isError(res)) {
			setError(res.error.message)
			return
		}
		setPreviewNames(res.value.interfaces.map((i) => i.name))
	}

	async function handleCreateMfr(e: SubmitEvent): Promise<void> {
		e.preventDefault()
		setError(null)
		const res = await create_manufacturer(
			mfrName(),
			mfrSlug(),
			mfrDescription().trim() || undefined,
		)
		if (Result.isError(res)) {
			setError(res.error.message)
			return
		}
		setMfrName('')
		setMfrSlug('')
		setMfrDescription('')
		void refetchMfrs()
	}

	async function handleCreateType(e: SubmitEvent): Promise<void> {
		e.preventDefault()
		setError(null)
		const height = Number(typeHeight())
		if (!Number.isInteger(height) || height < 0) {
			setError('U height must be an integer of 0 or more (0 = virtual/shelf-only)')
			return
		}
		const res = await create_device_type({
			manufacturer_id: Number(typeMfr()),
			model: typeModel(),
			slug: typeSlug(),
			u_height: height,
		})
		if (Result.isError(res)) {
			setError(res.error.message)
			return
		}
		setTypeModel('')
		setTypeSlug('')
		setTypeHeight('1')
		void refetchTypes()
	}

	async function handleCreateStub(e: SubmitEvent): Promise<void> {
		e.preventDefault()
		setError(null)
		const typeId = selectedType()
		if (!typeId) {
			setError('Select a device type first')
			return
		}
		const count = Number(stubCount())
		if (!Number.isInteger(count) || count < 1) {
			setError('Stub count must be an integer of at least 1')
			return
		}
		const res = await create_stub(typeId, { prefix: stubPrefix(), count })
		if (Result.isError(res)) {
			setError(res.error.message)
			return
		}
		setStubPrefix('')
		setStubCount('24')
		void refetchStubs()
		void refreshPreview(typeId)
	}

	async function handleAdhocPreview(): Promise<void> {
		setError(null)
		const count = Number(stubCount())
		if (!stubPrefix() || !Number.isInteger(count) || count < 1) {
			setError('Enter a prefix and a count of at least 1 to preview')
			return
		}
		const res = await fetch_adhoc_preview(stubPrefix(), count)
		if (Result.isError(res)) {
			setError(res.error.message)
			return
		}
		setPreviewNames(res.value.interfaces.map((i) => i.name))
	}

	async function handleSelectType(id: number): Promise<void> {
		setSelectedType(id)
		setError(null)
		void refetchStubs()
		void refreshPreview(id)
	}

	async function handleDeleteStub(stubId: number): Promise<void> {
		const typeId = selectedType()
		if (!typeId) {
			return
		}
		setError(null)
		const res = await delete_stub(typeId, stubId)
		if (Result.isError(res)) {
			setError(res.error.message)
			return
		}
		void refetchStubs()
		void refreshPreview(typeId)
	}

	return (
		<div>
			<h2>Manufacturers</h2>
			<form onSubmit={handleCreateMfr}>
				<input
					placeholder="Name"
					value={mfrName()}
					onInput={(e: InputEventAndTarget) => setMfrName(e.currentTarget.value)}
				/>
				<input
					placeholder="slug"
					value={mfrSlug()}
					onInput={(e: InputEventAndTarget) => setMfrSlug(e.currentTarget.value)}
				/>
				<input
					placeholder="Description (optional)"
					value={mfrDescription()}
					onInput={(e: InputEventAndTarget) => setMfrDescription(e.currentTarget.value)}
				/>
				<button type="submit">Add manufacturer</button>
			</form>
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
					<For each={manufacturers() ?? []}>
						{(m: ManufacturerRow): JSX.Element => (
							<tr>
								<td>{m.name}</td>
								<td>
									<code>{m.slug}</code>
								</td>
								<td class="cell-truncate" title={m.description ?? ''}>
									{m.description || '—'}
								</td>
								<td>
									<button
										type="button"
										class="btn-danger"
										onClick={async () => {
											setError(null)
											const res = await delete_manufacturer(m.id)
											if (Result.isError(res)) {
												setError(res.error.message)
												return
											}
											void refetchMfrs()
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

			<h2>Device types</h2>
			<form onSubmit={handleCreateType}>
				<input
					placeholder="Model"
					value={typeModel()}
					onInput={(e: InputEventAndTarget) => setTypeModel(e.currentTarget.value)}
				/>
				<input
					placeholder="slug"
					value={typeSlug()}
					onInput={(e: InputEventAndTarget) => setTypeSlug(e.currentTarget.value)}
				/>
				<input
					placeholder="U height (0 = virtual)"
					inputmode="numeric"
					value={typeHeight()}
					onInput={(e: InputEventAndTarget) => setTypeHeight(e.currentTarget.value)}
				/>
				<select
					value={typeMfr()}
					onChange={(e: Event & { currentTarget: HTMLSelectElement }) =>
						setTypeMfr(e.currentTarget.value)
					}
				>
					<option value="">Manufacturer…</option>
					<For each={manufacturers() ?? []}>
						{(m: ManufacturerRow): JSX.Element => (
							<option value={m.id}>{m.name}</option>
						)}
					</For>
				</select>
				<button type="submit">Add device type</button>
			</form>
			<table>
				<thead>
					<tr>
						<th>Model</th>
						<th>Slug</th>
						<th>Manufacturer</th>
						<th>U height</th>
						<th>Actions</th>
					</tr>
				</thead>
				<tbody>
					<For each={types() ?? []}>
						{(t: DeviceTypeRow): JSX.Element => (
							<tr>
								<td>{t.model}</td>
								<td>
									<code>{t.slug}</code>
								</td>
								<td>{mfrNameOf(t.manufacturer_id)}</td>
								<td>{t.u_height === 0 ? '0 (virtual)' : t.u_height}</td>
								<td>
									<button type="button" onClick={() => handleSelectType(t.id)}>
										{selectedType() === t.id ? 'Selected' : 'Select'}
									</button>{' '}
									<button
										type="button"
										class="btn-danger"
										onClick={async () => {
											setError(null)
											const res = await delete_device_type(t.id)
											if (Result.isError(res)) {
												setError(res.error.message)
												return
											}
											if (selectedType() === t.id) {
												setSelectedType(null)
												setPreviewNames([])
											}
											void refetchTypes()
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

			<Show when={selectedType() !== null}>
				<h2>Interface stubs</h2>
				<form onSubmit={handleCreateStub}>
					<input
						placeholder="Prefix (e.g. eth)"
						value={stubPrefix()}
						onInput={(e: InputEventAndTarget) => setStubPrefix(e.currentTarget.value)}
					/>
					<input
						placeholder="Count"
						inputmode="numeric"
						value={stubCount()}
						onInput={(e: InputEventAndTarget) => setStubCount(e.currentTarget.value)}
					/>
					<button type="submit">Add stub</button>{' '}
					<button type="button" onClick={handleAdhocPreview}>
						Preview {stubPrefix() || 'prefix'} × {stubCount() || '?'}
					</button>
				</form>
				<table>
					<thead>
						<tr>
							<th>Prefix</th>
							<th>Count</th>
							<th>Kind</th>
							<th>Actions</th>
						</tr>
					</thead>
					<tbody>
						<For each={stubs() ?? []}>
							{(s: StubRow): JSX.Element => (
								<tr>
									<td>
										<code>{s.prefix}</code>
									</td>
									<td>{s.count}</td>
									<td>{s.kind}</td>
									<td>
										<button
											type="button"
											class="btn-danger"
											onClick={() => handleDeleteStub(s.id)}
										>
											Delete
										</button>
									</td>
								</tr>
							)}
						</For>
					</tbody>
				</table>
				<h3>Expansion preview ({previewNames().length} interfaces)</h3>
				<p>
					<code>{previewNames().join(', ') || '—'}</code>
				</p>
			</Show>
			<Show when={error()}>
				<div class="app-inline-error">{error()}</div>
			</Show>
		</div>
	)
}
