import { DataTable, type DataTableColumn } from '@serkonda7/solid-components'
import { Result } from 'better-result'
import type { InputEventAndTarget } from 'shared/src/types'
import type { JSX } from 'solid-js'
import { createMemo, createResource, createSignal, For, Show } from 'solid-js'
import {
	create_device_type,
	create_manufacturer,
	create_stub,
	type DeviceTypeRow,
	type DeviceTypeSort,
	delete_device_type,
	delete_manufacturer,
	delete_stub,
	fetch_adhoc_preview,
	fetch_device_types,
	fetch_manufacturers,
	fetch_stubs,
	fetch_type_preview,
	type ManufacturerRow,
	type ManufacturerSort,
	type StubRow,
} from '../api_p3'
import { use_visible_columns } from '../util/column_visibility'

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
	const [mfrSort, setMfrSort] = createSignal<ManufacturerSort>('name')
	const [mfrOrder, setMfrOrder] = createSignal<'asc' | 'desc'>('asc')
	const [typeSort, setTypeSort] = createSignal<DeviceTypeSort>('model')
	const [typeOrder, setTypeOrder] = createSignal<'asc' | 'desc'>('asc')

	const mfrSource = createMemo(() => ({ sort: mfrSort(), order: mfrOrder() }))
	const typeSource = createMemo(() => ({ sort: typeSort(), order: typeOrder() }))

	const [manufacturers, { refetch: refetchMfrs }] = createResource(mfrSource, async (s) => {
		const res = await fetch_manufacturers(s)
		if (Result.isError(res)) {
			setError(res.error.message)
			return []
		}
		return res.value.items
	})
	const [types, { refetch: refetchTypes }] = createResource(typeSource, async (s) => {
		const res = await fetch_device_types(s)
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

	async function handleDeleteMfr(m: ManufacturerRow): Promise<void> {
		setError(null)
		const res = await delete_manufacturer(m.id)
		if (Result.isError(res)) {
			setError(res.error.message)
			return
		}
		void refetchMfrs()
	}

	async function handleDeleteType(t: DeviceTypeRow): Promise<void> {
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
	}

	const mfrColumns: DataTableColumn<ManufacturerRow>[] = [
		{
			key: 'name',
			label: 'Name',
			sortable: true,
			getValue: (m: ManufacturerRow): string => m.name,
		},
		{
			key: 'slug',
			label: 'Slug',
			sortable: true,
			getValue: (m: ManufacturerRow): JSX.Element => <code>{m.slug}</code>,
		},
		{
			key: 'description',
			label: 'Description',
			sortable: true,
			class: 'cell-truncate',
			getValue: (m: ManufacturerRow): JSX.Element => (
				<span title={m.description ?? ''}>{m.description || '—'}</span>
			),
		},
	]

	const typeColumns: DataTableColumn<DeviceTypeRow>[] = [
		{
			key: 'model',
			label: 'Model',
			sortable: true,
			getValue: (t: DeviceTypeRow): string => t.model,
		},
		{
			key: 'slug',
			label: 'Slug',
			sortable: true,
			getValue: (t: DeviceTypeRow): JSX.Element => <code>{t.slug}</code>,
		},
		{
			key: 'manufacturer',
			label: 'Manufacturer',
			getValue: (t: DeviceTypeRow): string => mfrNameOf(t.manufacturer_id),
		},
		{
			key: 'u_height',
			label: 'U height',
			getValue: (t: DeviceTypeRow): string | number =>
				t.u_height === 0 ? '0 (virtual)' : t.u_height,
		},
	]

	function handleMfrSort(key: string): void {
		const col = key as ManufacturerSort
		if (mfrSort() === col) {
			setMfrOrder(mfrOrder() === 'asc' ? 'desc' : 'asc')
		} else {
			setMfrSort(col)
			setMfrOrder('asc')
		}
	}

	function handleTypeSort(key: string): void {
		const col = key as DeviceTypeSort
		if (typeSort() === col) {
			setTypeOrder(typeOrder() === 'asc' ? 'desc' : 'asc')
		} else {
			setTypeSort(col)
			setTypeOrder('asc')
		}
	}

	const template_mfr_keys = mfrColumns.map((c) => c.key)
	const [visibleMfrColumns, setVisibleMfrColumns] = use_visible_columns(
		'templates-manufacturers',
		template_mfr_keys,
	)
	const template_type_keys = typeColumns.map((c) => c.key)
	const [visibleTypeColumns, setVisibleTypeColumns] = use_visible_columns(
		'templates-device-types',
		template_type_keys,
	)

	const stubColumns: DataTableColumn<StubRow>[] = [
		{
			key: 'prefix',
			label: 'Prefix',
			getValue: (s: StubRow): JSX.Element => <code>{s.prefix}</code>,
		},
		{ key: 'count', label: 'Count', getValue: (s: StubRow): number => s.count },
		{ key: 'kind', label: 'Kind', getValue: (s: StubRow): string => s.kind },
	]

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
			<DataTable
				rows={() => manufacturers() ?? []}
				getRowId={(m: ManufacturerRow): number => m.id}
				columns={mfrColumns}
				sortKey={mfrSort}
				sortDirection={mfrOrder}
				onSort={handleMfrSort}
				showColumnCustomizer
				visibleColumns={visibleMfrColumns}
				onVisibleColumnsChange={setVisibleMfrColumns}
				rowActions={(m: ManufacturerRow): JSX.Element => (
					<button type="button" class="btn-danger" onClick={() => handleDeleteMfr(m)}>
						Delete
					</button>
				)}
				loading={() => manufacturers.loading}
				loadingContent={<p class="skeleton">Loading manufacturers…</p>}
				emptyContent={<p class="empty">No manufacturers yet.</p>}
			/>

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
			<DataTable
				rows={() => types() ?? []}
				getRowId={(t: DeviceTypeRow): number => t.id}
				columns={typeColumns}
				sortKey={typeSort}
				sortDirection={typeOrder}
				onSort={handleTypeSort}
				showColumnCustomizer
				visibleColumns={visibleTypeColumns}
				onVisibleColumnsChange={setVisibleTypeColumns}
				rowActions={(t: DeviceTypeRow): JSX.Element => (
					<span>
						<button type="button" onClick={() => handleSelectType(t.id)}>
							{selectedType() === t.id ? 'Selected' : 'Select'}
						</button>{' '}
						<button
							type="button"
							class="btn-danger"
							onClick={() => handleDeleteType(t)}
						>
							Delete
						</button>
					</span>
				)}
				loading={() => types.loading}
				loadingContent={<p class="skeleton">Loading device types…</p>}
				emptyContent={<p class="empty">No device types yet.</p>}
			/>

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
				<DataTable
					rows={() => stubs() ?? []}
					getRowId={(s: StubRow): number => s.id}
					columns={stubColumns}
					showColumnCustomizer
					rowActions={(s: StubRow): JSX.Element => (
						<button
							type="button"
							class="btn-danger"
							onClick={() => handleDeleteStub(s.id)}
						>
							Delete
						</button>
					)}
					loading={() => stubs.loading}
					loadingContent={<p class="skeleton">Loading stubs…</p>}
					emptyContent={<p class="empty">No stubs yet.</p>}
				/>
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
